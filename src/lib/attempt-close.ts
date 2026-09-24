import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts } from "@/db/schema";
import { attemptElapsedMs } from "@/lib/attempts";
import { submitAttempt } from "@/lib/attempt-submit";

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

export type OverallBudget = {
  limitSeconds: number | null;
  elapsedMs: number;
  remainingMs: number | null;
  exhausted: boolean;
};

/** Where an attempt stands against its budget. Null limit means unlimited, never exhausted. */
export async function overallBudget(attemptId: string): Promise<OverallBudget> {
  const attempt = await db
    .select({
      limit: attempts.overallTimeLimitSeconds,
      activeQuestionStartedAt: attempts.activeQuestionStartedAt,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .get();
  if (!attempt) throw new Error("Attempt not found.");

  const answers = await db
    .select({
      durationMs: attemptAnswers.durationMs,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));

  const elapsedMs = attemptElapsedMs(answers, attempt.activeQuestionStartedAt);
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
 * Closes an attempt whose budget is spent. Persisted drafts are finalized as answers; questions
 * with no response are recorded as timed out.
 */
export async function closeForTimeout(attemptId: string) {
  return submitAttempt(attemptId, "timeout");
}
