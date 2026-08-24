import { NextResponse } from "next/server";

import { resetAttempt } from "@/lib/catalog";

export const runtime = "nodejs";

/**
 * Clears an attempt's progress so it can be run again under the same link.
 *
 * Researcher-only, and a subpath rather than another verb on `/api/attempts/<id>` so that it
 * cannot be reached by the participant allowlist, which opens the bare attempt path for GET and
 * `answers`/`interaction`/`timeout` for POST. Nothing here is offered to a participant: erasing
 * their own recorded answers is precisely what a link holder must not be able to do.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await resetAttempt(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset the attempt.";
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 400 },
    );
  }
}
