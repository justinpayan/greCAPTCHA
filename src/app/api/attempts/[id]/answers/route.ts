import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attemptAnswers, attempts } from "@/db/schema";
import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { getAttemptState, getCurrentAnswer, loadAttemptContext } from "@/lib/attempts";
import { finalizeAttempt } from "@/lib/grading";
import { answerSubmissionSchema, type FillReview } from "@/lib/quiz";

export const runtime = "nodejs";
export const maxDuration = 300;

function normalizeAnswer(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const submission = answerSubmissionSchema.parse(await request.json());
    // Checked on every submission, not just the first open, so closing a link stops an
    // assessment that is already under way.
    await requireOpenAttempt(id);
    const quiz = await loadAttemptContext(id);
    if (quiz.attempt.status === "graded") {
      return NextResponse.json({ error: "This attempt is already complete." }, { status: 409 });
    }
    if (quiz.attempt.status !== "active") {
      throw new Error("This attempt is not available for answers.");
    }

    const answerRow = await getCurrentAnswer(id, quiz.currentQuestion.id);
    if (!answerRow) throw new Error("The current question has not been started.");
    const isFinalQuestion = quiz.attempt.currentIndex === quiz.order.length - 1;

    if (answerRow.submittedAt) {
      if (isFinalQuestion) {
        return NextResponse.json({ result: await finalizeAttempt(quiz) });
      }
      return NextResponse.json({ error: "This answer is already locked." }, { status: 409 });
    }

    if (submission.type !== quiz.currentQuestion.type) {
      throw new Error("The submitted answer type does not match the current question.");
    }

    const submittedAt = new Date();
    const durationMs = Math.max(
      0,
      submittedAt.getTime() - new Date(answerRow.startedAt).getTime(),
    );
    // Soft timer: an overrun is recorded, never enforced. The limit comes from the row
    // stamped when the question was first served, not from the current question set.
    const timeLimitSeconds = answerRow.timeLimitSeconds;
    const overrunMs =
      timeLimitSeconds === null
        ? null
        : Math.max(0, durationMs - timeLimitSeconds * 1000);
    let answerJson: string;
    let score: number | null = null;
    let feedbackJson: string | null = null;

    if (quiz.currentQuestion.type === "fill_blank" && submission.type === "fill_blank") {
      // Bind the narrowed question to a const so the type survives into the callback below.
      const fillQuestion = quiz.currentQuestion;
      const blankFeedback: FillReview["blanks"] = fillQuestion.blanks.map((blank) => {
        const selectedChoiceId = submission.selections[blank.id] ?? null;
        const selectedChoice = fillQuestion.choices.find(
          (choice) => choice.id === selectedChoiceId,
        );
        const selectedAnswer = selectedChoice?.label ?? null;
        const correct =
          selectedAnswer !== null &&
          normalizeAnswer(selectedAnswer) === normalizeAnswer(blank.answer);
        return {
          blankId: blank.id,
          selectedAnswer,
          correctAnswer: blank.answer,
          correct,
        };
      });
      score =
        (blankFeedback.filter((blank) => blank.correct).length /
          Math.max(blankFeedback.length, 1)) *
        100;
      answerJson = JSON.stringify({ selections: submission.selections });
      feedbackJson = JSON.stringify({ blanks: blankFeedback });
    } else if (
      quiz.currentQuestion.type === "multiple_choice" &&
      submission.type === "multiple_choice"
    ) {
      const question = quiz.currentQuestion;
      if (!question.options.some((option) => option.id === submission.optionId)) {
        throw new Error("The selected option does not belong to this question.");
      }
      const correct = submission.optionId === question.correctOptionId;
      score = correct ? 100 : 0;
      answerJson = JSON.stringify({ optionId: submission.optionId });
      feedbackJson = JSON.stringify({ correct });
    } else if (
      quiz.currentQuestion.type === "free_response" &&
      submission.type === "free_response"
    ) {
      answerJson = JSON.stringify({ response: submission.response });
    } else {
      throw new Error("The submitted answer type does not match the current question.");
    }

    const update = await db
      .update(attemptAnswers)
      .set({
        answerJson,
        submittedAt: submittedAt.toISOString(),
        durationMs,
        overrunMs,
        score,
        feedbackJson,
      })
      .where(and(eq(attemptAnswers.id, answerRow.id), isNull(attemptAnswers.submittedAt)))
      .run();
    if (update.changes !== 1) {
      return NextResponse.json({ error: "This answer is already locked." }, { status: 409 });
    }

    if (isFinalQuestion) {
      return NextResponse.json({ result: await finalizeAttempt(quiz) });
    }

    await db
      .update(attempts)
      .set({ currentIndex: quiz.attempt.currentIndex + 1 })
      .where(eq(attempts.id, id))
      .run();
    return NextResponse.json(await getAttemptState(id));
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json(
        { error: error.message, locked: true, paused: error.paused },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to submit answer.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
