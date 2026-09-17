import { NextResponse } from "next/server";

import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { closeForTimeout, overallBudget } from "@/lib/attempt-close";
import { getAttemptState } from "@/lib/attempts";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Closes an attempt whose overall time limit has run out.
 *
 * Called by the participant's countdown when it reaches zero, but the server checks the budget
 * itself: a client that fires early — through a wrong clock, a replayed request, or a deliberate
 * one — gets its current question back instead. The browser can only ask for prompt enforcement,
 * never cause it.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireOpenAttempt(id);

    const budget = await overallBudget(id);
    if (!budget.exhausted) {
      return NextResponse.json({ ...(await getAttemptState(id)), closed: false });
    }
    const grading = await closeForTimeout(id);
    return NextResponse.json(
      { ...grading, closed: true },
      { status: "result" in grading ? 200 : 202 },
    );
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json(
        { error: error.message, locked: true, paused: error.paused },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to close the attempt.";
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 400 },
    );
  }
}
