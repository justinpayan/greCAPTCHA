import "server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts } from "@/db/schema";
import { attemptElapsedMs, loadAttemptContext } from "@/lib/attempts";
import { enqueueGradingJob } from "@/lib/jobs";
import { noCreditFeedbackJson } from "@/lib/no-credit";
import { questionTimeLimit } from "@/lib/quiz";

/**
 * Enforcement of the overall time limit.
 *
 * The rule is that **no further question is served once the budget is spent**. An answer the
 * participant had already entered still counts — the bell does not snatch back work in progress —
 * but the attempt closes rather than moving on.
 *
 * Enforcement lives here rather than in the browser. The client's countdown only asks the server
 * to close promptly; a participant who closes the tab, blocks JavaScript, or leaves the laptop
 * asleep is closed out on their next request instead.
 */

const TIMED_OUT_FEEDBACK = "Not reached: the overall time limit for this set ran out.";

export type OverallBudget = {
  limitSeconds: number | null;
  elapsedMs: number;
  remainingMs: number | null;
  exhausted: boolean;
};

/** Where an attempt stands against its budget. Null limit means unlimited, never exhausted. */
export async function overallBudget(attemptId: string): Promise<OverallBudget> {
  const attempt = await db
    .select({ limit: attempts.overallTimeLimitSeconds })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .get();
  if (!attempt) throw new Error("Attempt not found.");

  const answers = await db
    .select({
      startedAt: attemptAnswers.startedAt,
      submittedAt: attemptAnswers.submittedAt,
      durationMs: attemptAnswers.durationMs,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));

  const elapsedMs = attemptElapsedMs(answers);
  if (attempt.limit === null) {
    return { limitSeconds: null, elapsedMs, remainingMs: null, exhausted: false };
  }
  const remainingMs = attempt.limit * 1000 - elapsedMs;
  return {
    limitSeconds: attempt.limit,
    elapsedMs,
    remainingMs,
    exhausted: remainingMs <= 0,
  };
}

/**
 * Closes an attempt whose budget is spent and returns its graded result.
 *
 * Every question without a submitted answer is recorded as timed out and scored 0 — the one that
 * was open when the bell rang keeps the time it had accumulated, and the ones never reached get a
 * zero duration, which keeps "how long did this item take" honest for the items that did run.
 */
export async function closeForTimeout(attemptId: string) {
  const quiz = await loadAttemptContext(attemptId);
  if (quiz.attempt.status === "graded" && quiz.attempt.gradingJson) {
    return { result: JSON.parse(quiz.attempt.gradingJson) };
  }

  const existing = await db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));
  const rowByQuestion = new Map(existing.map((row) => [row.questionId, row]));
  const closedAt = new Date();

  for (const questionId of quiz.order) {
    const question = quiz.questionById.get(questionId);
    if (!question) continue;
    const row = rowByQuestion.get(questionId);
    if (row?.submittedAt) continue;

    const limitSeconds = questionTimeLimit(question);
    const feedbackJson = noCreditFeedbackJson(question, TIMED_OUT_FEEDBACK);

    if (row) {
      const durationMs = Math.max(0, closedAt.getTime() - new Date(row.startedAt).getTime());
      await db
        .update(attemptAnswers)
        .set({
          submittedAt: closedAt.toISOString(),
          durationMs,
          overrunMs: limitSeconds === null ? null : Math.max(0, durationMs - limitSeconds * 1000),
          score: 0,
          timedOut: true,
          feedbackJson,
        })
        .where(eq(attemptAnswers.id, row.id))
        .run();
      continue;
    }

    await db.insert(attemptAnswers).values({
      id: randomUUID(),
      attemptId,
      questionId,
      questionType: question.type,
      blockName: question.blockName ?? "",
      startedAt: closedAt.toISOString(),
      submittedAt: closedAt.toISOString(),
      durationMs: 0,
      timeLimitSeconds: limitSeconds,
      overrunMs: limitSeconds === null ? null : 0,
      score: 0,
      timedOut: true,
      feedbackJson,
    });
  }

  // Point at the last question so nothing tries to serve a further one.
  await db
    .update(attempts)
    .set({ currentIndex: Math.max(0, quiz.order.length - 1) })
    .where(eq(attempts.id, attemptId))
    .run();

  return enqueueGradingJob(attemptId);
}
