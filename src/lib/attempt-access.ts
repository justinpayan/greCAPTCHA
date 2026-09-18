import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { attempts } from "@/db/schema";
import { hasResearcherSession } from "@/lib/session";

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

export class AttemptClosedError extends Error {
  /** True when the attempt had progressed past its first question before being closed. */
  readonly paused: boolean;
  readonly expired: boolean;

  constructor(paused: boolean, expired = false) {
    super(expired ? ATTEMPT_EXPIRED_MESSAGE : paused ? ATTEMPT_PAUSED_MESSAGE : ATTEMPT_CLOSED_MESSAGE);
    this.name = "AttemptClosedError";
    this.paused = paused;
    this.expired = expired;
  }
}

/**
 * Throws unless the attempt may be worked on by whoever is asking.
 *
 * A valid researcher session passes regardless of the flag, which is what makes an in-person
 * session work without arming the link first. It also means "closed" is a control over the
 * mailed link, not a lock against the password holder.
 */
export async function requireOpenAttempt(attemptId: string) {
  const attempt = await db
    .select({
      linkEnabled: attempts.linkEnabled,
      linkExpiresAt: attempts.linkExpiresAt,
      currentIndex: attempts.currentIndex,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .get();
  if (!attempt) throw new Error("Attempt not found.");
  const expired =
    attempt.linkExpiresAt !== null &&
    new Date(attempt.linkExpiresAt).getTime() <= Date.now();
  if (attempt.linkEnabled && !expired) return;
  if (await hasResearcherSession()) return;
  throw new AttemptClosedError(attempt.currentIndex > 0, expired);
}
