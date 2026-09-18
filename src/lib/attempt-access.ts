import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { attempts, questionSets } from "@/db/schema";
import { currentUser } from "@/lib/session";

/**
 * Whether a participant is allowed to work on an attempt right now.
 *
 * Participant links are handed out before a session starts, so the attempt ID alone must not
 * be enough to begin: the researcher arms the link when the session actually starts. Every
 * participant-facing endpoint calls the guard below, so closing a link mid-session halts the
 * assessment at once rather than only blocking the first open.
 */

/**
 * Shown to the participant, so these explain the situation rather than naming a flag. An
 * attempt that is already under way gets the second wording: "not open yet" would be wrong
 * for someone who has been answering questions for ten minutes.
 */
export const ATTEMPT_CLOSED_MESSAGE =
  "This assessment link is not active.";
export const ATTEMPT_PAUSED_MESSAGE =
  "This assessment is no longer available. Every answer you submitted is saved.";
export const ATTEMPT_EXPIRED_MESSAGE =
  "This assessment link has expired. Ask the person who created it for a new link.";
export const ATTEMPT_CLAIMED_MESSAGE =
  "This one-time assessment link has already been claimed by another account.";

export class AttemptClosedError extends Error {
  /** True when the attempt had progressed past its first question before being closed. */
  readonly paused: boolean;
  readonly expired: boolean;
  readonly claimed: boolean;

  constructor(paused: boolean, expired = false, claimed = false) {
    super(
      claimed
        ? ATTEMPT_CLAIMED_MESSAGE
        : expired
          ? ATTEMPT_EXPIRED_MESSAGE
          : paused
            ? ATTEMPT_PAUSED_MESSAGE
            : ATTEMPT_CLOSED_MESSAGE,
    );
    this.name = "AttemptClosedError";
    this.paused = paused;
    this.expired = expired;
    this.claimed = claimed;
  }
}

/**
 * Throws unless the attempt may be worked on by whoever is asking.
 *
 * A valid researcher session passes regardless of the flag, which is what makes an in-person
 * session work without arming the link first. It also means "closed" is a control over the
 * mailed link, not a lock against the password holder.
 */
export async function requireOpenAttempt(
  attemptId: string,
  options: { allowUnclaimed?: boolean; claim?: boolean } = {},
) {
  const user = await currentUser();
  if (!user) throw new Error("Not authorised.");
  const attempt = await db
    .select({
      ownerUserId: questionSets.ownerUserId,
      linkEnabled: attempts.linkEnabled,
      linkExpiresAt: attempts.linkExpiresAt,
      takerUserId: attempts.takerUserId,
      currentIndex: attempts.currentIndex,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .where(eq(attempts.id, attemptId))
    .get();
  if (!attempt) throw new Error("Attempt not found.");
  if (attempt.ownerUserId === user.id) return;
  const expired =
    attempt.linkExpiresAt !== null &&
    new Date(attempt.linkExpiresAt).getTime() <= Date.now();
  if (!attempt.linkEnabled || expired) {
    throw new AttemptClosedError(attempt.currentIndex > 0, expired);
  }
  if (attempt.takerUserId === user.id) return;
  if (attempt.takerUserId) {
    throw new AttemptClosedError(attempt.currentIndex > 0, false, true);
  }
  if (options.allowUnclaimed) return;
  if (options.claim) {
    const claimed = await db
      .update(attempts)
      .set({ takerUserId: user.id, takerUsername: user.username })
      .where(and(eq(attempts.id, attemptId), isNull(attempts.takerUserId)))
      .run();
    if (claimed.changes === 1) return;
    const winner = await db
      .select({ takerUserId: attempts.takerUserId })
      .from(attempts)
      .where(eq(attempts.id, attemptId))
      .get();
    if (winner?.takerUserId === user.id) return;
    throw new AttemptClosedError(attempt.currentIndex > 0, false, true);
  }
  throw new AttemptClosedError(attempt.currentIndex > 0);
}
