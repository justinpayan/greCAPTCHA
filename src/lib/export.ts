import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  attemptAnswers,
  attemptFeedback,
  attempts,
  questionSets,
} from "@/db/schema";
import { questionSetLabel } from "@/lib/catalog";
import { isWarmup, type StoredQuestion } from "@/lib/quiz";

/**
 * One row per question that was served, across every attempt.
 *
 * Deliberately the answer grain rather than the attempt grain: the per-family
 * discrimination index in §10 needs `block_name`, per-item score and per-item timing on the
 * same row, which an attempt-level summary cannot reconstruct. Attempt and set fields are
 * denormalized onto every row so the file stands alone with no joins.
 *
 * A row with an empty `submitted_at` is a question the participant reached but did not
 * answer, which is worth keeping — it shows where an attempt stopped.
 */
const COLUMNS = [
  "attempt_id",
  "question_set_id",
  "set_name",
  "paper_name",
  "model_id",
  "workflow_type",
  "attempt_status",
  "attempt_score",
  "randomize",
  "countdown_hidden",
  "attempt_created_at",
  "attempt_completed_at",
  "position",
  "question_id",
  "block_name",
  "question_type",
  "warmup",
  "time_limit_seconds",
  "started_at",
  "first_interaction_at",
  "first_interaction_ms",
  "submitted_at",
  "duration_ms",
  "overrun_ms",
  "score",
  // A skip scores 0 like a wrong answer, so without this column the two are indistinguishable
  // in the data — and declining a question is a different behaviour from getting it wrong.
  "skipped",
  // Distinct from `skipped`: the overall limit ran out before this question was answered.
  "timed_out",
  "response",
  "correct_answer",
  "correct",
  "grader_feedback",
  "examinee_feedback",
  "examinee_feedback_submitted_at",
] as const;

/** RFC 4180 quoting: a field is quoted when it holds a quote, comma, or newline. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Resolves what the participant submitted, and the key, into readable text.
 *
 * A skipped question has no answer JSON. Its key is still reported — that is a property of the
 * item, not of the answer — but `response` has to read as genuinely empty rather than as a set
 * of empty blank selections, which would look like an answer that was given.
 */
function describeAnswer(question: StoredQuestion | undefined, answerJson: string | null) {
  if (!question) return { response: "", correctAnswer: "", correct: "" };
  const answered = Boolean(answerJson);

  if (question.type === "free_response") {
    const parsed = parseJson<{ response?: string }>(answerJson, {});
    return { response: parsed.response ?? "", correctAnswer: "", correct: "" };
  }

  if (question.type === "multiple_choice") {
    const parsed = parseJson<{ optionId?: string }>(answerJson, {});
    const chosen = question.options.find((option) => option.id === parsed.optionId);
    const key = question.options.find((option) => option.id === question.correctOptionId);
    return {
      response: chosen?.label ?? "",
      correctAnswer: key?.label ?? "",
      correct: parsed.optionId ? String(parsed.optionId === question.correctOptionId) : "",
    };
  }

  const parsed = parseJson<{ selections?: Record<string, string | null> }>(answerJson, {});
  const labelFor = (choiceId: string | null | undefined) =>
    question.choices.find((choice) => choice.id === choiceId)?.label ?? "";
  const chosen = answered
    ? question.blanks
        .map((blank) => `${blank.id}=${labelFor(parsed.selections?.[blank.id])}`)
        .join("; ")
    : "";
  const key = question.blanks.map((blank) => `${blank.id}=${blank.answer}`).join("; ");
  return { response: chosen, correctAnswer: key, correct: "" };
}

export async function buildAnswerCsv(ownerUserId: string): Promise<string> {
  const rows = await db
    .select({
      answer: attemptAnswers,
      attempt: attempts,
      set: questionSets,
      examineeFeedback: attemptFeedback,
    })
    .from(attemptAnswers)
    .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .leftJoin(attemptFeedback, eq(attemptFeedback.attemptId, attempts.id))
    .where(eq(questionSets.ownerUserId, ownerUserId))
    .orderBy(asc(attempts.createdAt), asc(attemptAnswers.startedAt));

  // Question sets are parsed once each; a set with 50 questions is shared by every attempt.
  const questionCache = new Map<string, Map<string, StoredQuestion>>();
  const orderCache = new Map<string, string[]>();

  const lines: string[] = [COLUMNS.join(",")];

  for (const { answer, attempt, set, examineeFeedback } of rows) {
    if (!questionCache.has(set.id)) {
      const parsed = parseJson<StoredQuestion[]>(set.questionsJson, []);
      questionCache.set(set.id, new Map(parsed.map((q) => [q.id, q])));
    }
    if (!orderCache.has(attempt.id)) {
      orderCache.set(attempt.id, parseJson<string[]>(attempt.questionOrderJson, []));
    }
    const question = questionCache.get(set.id)?.get(answer.questionId);
    const position = (orderCache.get(attempt.id) ?? []).indexOf(answer.questionId) + 1;
    const described = describeAnswer(question, answer.answerJson);
    const feedback = parseJson<{ feedback?: string }>(answer.feedbackJson, {}).feedback ?? "";

    lines.push(
      [
        attempt.id,
        set.id,
        questionSetLabel(set.name, set.paperName),
        set.paperName,
        set.modelId,
        set.workflowType,
        attempt.status,
        attempt.score,
        attempt.randomize,
        attempt.countdownHidden,
        attempt.createdAt,
        attempt.completedAt,
        position || "",
        answer.questionId,
        answer.blockName,
        answer.questionType,
        question ? isWarmup(question) : "",
        answer.timeLimitSeconds,
        answer.startedAt,
        answer.firstInteractionAt,
        answer.firstInteractionMs,
        answer.submittedAt,
        answer.durationMs,
        answer.overrunMs,
        answer.score,
        answer.skipped,
        answer.timedOut,
        described.response,
        described.correctAnswer,
        described.correct,
        feedback,
        examineeFeedback?.comment ?? "",
        examineeFeedback?.submittedAt ?? "",
      ]
        .map(csvField)
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}
