import "server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts } from "@/db/schema";
import { backupInBackground } from "@/lib/backup";
import { loadAttemptContext } from "@/lib/attempts";
import { noCreditFeedbackJson } from "@/lib/no-credit";
import {
  draftHasAnswer,
  parseDraft,
  questionBlockName,
  questionTimeLimit,
  type AssessmentResult,
  type FillReview,
  type StoredQuestion,
} from "@/lib/quiz";

export type SubmissionReason = "manual" | "timeout";

function normalizeAnswer(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function gradeDraft(question: StoredQuestion, answerJson: string | null) {
  const draft = parseDraft(question, answerJson);
  if (!draftHasAnswer(draft)) return null;

  if (question.type === "fill_blank" && draft.type === "fill_blank") {
    const blanks: FillReview["blanks"] = question.blanks.map((blank) => {
      const selected = question.choices.find(
        (choice) => choice.id === draft.selections[blank.id],
      );
      const selectedAnswer = selected?.label ?? null;
      return {
        blankId: blank.id,
        selectedAnswer,
        correctAnswer: blank.answer,
        correct:
          selectedAnswer !== null &&
          normalizeAnswer(selectedAnswer) === normalizeAnswer(blank.answer),
      };
    });
    return {
      answerJson: JSON.stringify(draft),
      score: (blanks.filter((blank) => blank.correct).length / Math.max(blanks.length, 1)) * 100,
      feedbackJson: JSON.stringify({ blanks }),
    };
  }

  if (question.type === "multiple_choice" && draft.type === "multiple_choice") {
    if (!draft.optionId || !question.options.some((option) => option.id === draft.optionId)) {
      return null;
    }
    const correct = draft.optionId === question.correctOptionId;
    return {
      answerJson: JSON.stringify(draft),
      score: correct ? 100 : 0,
      feedbackJson: JSON.stringify({ correct }),
    };
  }

  if (question.type === "free_response" && draft.type === "free_response") {
    if (!draft.response.trim()) return null;
    return {
      answerJson: JSON.stringify(draft),
      score: null,
      feedbackJson: null,
    };
  }
  return null;
}

/**
 * Lock every persisted draft in one operation-shaped pass. The timeout and manual submit paths
 * intentionally share this logic so entered work is treated identically at the bell.
 */
export async function submitAttempt(attemptId: string, reason: SubmissionReason) {
  const quiz = await loadAttemptContext(attemptId);
  if (quiz.attempt.status === "graded" && quiz.attempt.gradingJson) {
    return { result: JSON.parse(quiz.attempt.gradingJson) as AssessmentResult };
  }
  if (quiz.attempt.status !== "active") return { pendingEvaluation: true as const };

  const closedAt = new Date();
  const existing = await db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));
  const rowByQuestion = new Map(existing.map((row) => [row.questionId, row]));
  const currentQuestionId = quiz.order[quiz.attempt.currentIndex];

  for (const questionId of quiz.order) {
    const question = quiz.questionById.get(questionId);
    if (!question) continue;
    const row = rowByQuestion.get(questionId);
    const activeVisitMs =
      questionId === currentQuestionId && quiz.attempt.activeQuestionStartedAt
        ? Math.max(
            0,
            closedAt.getTime() - new Date(quiz.attempt.activeQuestionStartedAt).getTime(),
          )
        : 0;
    const durationMs = (row?.durationMs ?? 0) + activeVisitMs;
    const timeLimitSeconds = row?.timeLimitSeconds ?? questionTimeLimit(question);
    const overrunMs =
      timeLimitSeconds === null ? null : Math.max(0, durationMs - timeLimitSeconds * 1000);
    const graded = gradeDraft(question, row?.answerJson ?? null);
    const unansweredMessage =
      reason === "timeout"
        ? "Not answered before the overall time limit ran out."
        : "Skipped. No response was submitted to grade.";
    const values = graded
      ? {
          ...graded,
          skipped: false,
          timedOut: false,
        }
      : {
          answerJson: null,
          score: 0,
          feedbackJson: noCreditFeedbackJson(question, unansweredMessage),
          skipped: reason === "manual",
          timedOut: reason === "timeout",
        };

    if (row) {
      await db
        .update(attemptAnswers)
        .set({
          ...values,
          submittedAt: closedAt.toISOString(),
          durationMs,
          overrunMs,
        })
        .where(eq(attemptAnswers.id, row.id))
        .run();
    } else {
      await db.insert(attemptAnswers).values({
        id: randomUUID(),
        attemptId,
        questionId,
        questionType: question.type,
        blockName: questionBlockName(question),
        startedAt: closedAt.toISOString(),
        submittedAt: closedAt.toISOString(),
        durationMs: 0,
        timeLimitSeconds,
        overrunMs: timeLimitSeconds === null ? null : 0,
        ...values,
      });
    }
  }

  await db
    .update(attempts)
    .set({
      status: "submitted",
      completedAt: closedAt.toISOString(),
      activeQuestionStartedAt: null,
    })
    .where(eq(attempts.id, attemptId))
    .run();
  backupInBackground("assessment-submitted");
  const { enqueueAutomaticGrading } = await import("@/lib/jobs");
  return enqueueAutomaticGrading(attemptId);
}
