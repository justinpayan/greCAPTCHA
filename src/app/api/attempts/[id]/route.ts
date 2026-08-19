import { NextResponse } from "next/server";

import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { closeForTimeout, overallBudget } from "@/lib/attempt-close";
import { getAttemptState } from "@/lib/attempts";
import { deleteAttempt, setAttemptLinkEnabled } from "@/lib/catalog";

export const runtime = "nodejs";

/**
 * A closed link answers 403 with `locked: true` so the participant screen can say "not open
 * yet" instead of showing a generic failure. Only reached by requests without a researcher
 * session; the Start button on the plan page passes the guard.
 */
function errorResponse(error: unknown, fallback: string) {
  if (error instanceof AttemptClosedError) {
    return NextResponse.json(
      { error: error.message, locked: true, paused: error.paused },
      { status: 403 },
    );
  }
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json(
    { error: message },
    { status: message === "Attempt not found." ? 404 : 400 },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireOpenAttempt(id);
    // No further question is served once the overall budget is spent. Checked here rather than
    // inside getAttemptState, which would stamp a clock start before anyone noticed.
    const budget = await overallBudget(id);
    if (budget.exhausted) {
      return NextResponse.json({ result: await closeForTimeout(id) });
    }
    return NextResponse.json(await getAttemptState(id));
  } catch (error) {
    return errorResponse(error, "Unable to load attempt.");
  }
}

/**
 * Opens or closes the participant link. Researcher-only: the middleware allows this path to
 * participants for GET alone, so PATCH stays behind the password like DELETE does.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { linkEnabled?: unknown };
    if (typeof body.linkEnabled !== "boolean") {
      throw new Error("linkEnabled must be true or false.");
    }
    return NextResponse.json({ linkEnabled: await setAttemptLinkEnabled(id, body.linkEnabled) });
  } catch (error) {
    return errorResponse(error, "Unable to update the attempt link.");
  }
}

/** Deletes one attempt and its answers. The question set is untouched. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await deleteAttempt(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error, "Unable to delete the attempt.");
  }
}
