import { NextResponse } from "next/server";

import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { getAttemptIntro } from "@/lib/attempts";

export const runtime = "nodejs";

/**
 * Facts for the landing page that precedes a question set.
 *
 * Participant-facing, and the one attempt endpoint that reads without serving: it records no
 * question-open duration, so timing starts on Start rather than on page load. It carries no
 * card names, descriptions or warm-up flags — `/outline` is the researcher's view and stays
 * behind the password.
 *
 * A closed link answers 403 here in the same shape as the question endpoint, so the landing
 * page and the assessment both show the "not open yet" screen.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireOpenAttempt(id, { allowUnclaimed: true });
    return NextResponse.json({ intro: await getAttemptIntro(id) });
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json(
        {
          error: error.message,
          locked: true,
          paused: error.paused,
          expired: error.expired,
          claimed: error.claimed,
        },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to open this assessment.";
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 400 },
    );
  }
}
