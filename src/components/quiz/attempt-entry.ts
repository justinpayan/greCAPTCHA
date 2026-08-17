import type { AssessmentResult, AttemptIntro, AttemptView } from "@/lib/quiz";

/**
 * How an attempt should open. Shared by the participant link and the researcher dashboard so
 * the two cannot drift on a decision that governs when a clock starts.
 */
export type AttemptEntry =
  | { kind: "result"; result: AssessmentResult }
  | { kind: "question"; attempt: AttemptView }
  | { kind: "intro"; intro: AttemptIntro }
  | { kind: "closed"; message: string; paused: boolean };

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Decides what to show for an attempt without serving a question unless one is due.
 *
 * The landing page is skipped for an attempt already under way: its clock is running, so
 * offering a Start button would misrepresent the state. Reading the intro first costs one
 * request and is what keeps a participant sitting on the landing page from burning question
 * one's time.
 */
export async function loadAttemptEntry(attemptId: string): Promise<AttemptEntry> {
  const id = encodeURIComponent(attemptId);
  const response = await fetch(`/api/attempts/${id}/intro`);
  const payload = await readJson(response);

  if (response.status === 403 && payload.locked) {
    return {
      kind: "closed",
      message: String(payload.error ?? "This assessment is not open."),
      paused: payload.paused === true,
    };
  }
  if (!response.ok) throw new Error(String(payload.error ?? "Unable to open this assessment."));

  const intro = payload.intro as AttemptIntro;
  if (intro.status !== "graded" && !intro.started) return { kind: "intro", intro };
  return serveAttempt(attemptId);
}

/** Serves the current question, which stamps its clock, or returns a finished attempt's result. */
export async function serveAttempt(attemptId: string): Promise<AttemptEntry> {
  const response = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}`);
  const payload = await readJson(response);

  if (response.status === 403 && payload.locked) {
    return {
      kind: "closed",
      message: String(payload.error ?? "This assessment is not open."),
      paused: payload.paused === true,
    };
  }
  if (!response.ok) throw new Error(String(payload.error ?? "Unable to open this assessment."));

  if (payload.result) return { kind: "result", result: payload.result as AssessmentResult };
  return { kind: "question", attempt: payload.attempt as AttemptView };
}
