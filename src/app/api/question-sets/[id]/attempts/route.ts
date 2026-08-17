import { NextResponse } from "next/server";

import { createAttempt } from "@/lib/attempts";

export const runtime = "nodejs";

/**
 * Creates an attempt and returns its ID only. No question is served here, so question one's
 * clock does not start until someone actually opens the assessment — attempts are often
 * created days before the session. The link is created closed.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      randomize?: unknown;
      countdownHidden?: unknown;
    };
    const created = await createAttempt({
      questionSetId: id,
      randomize: body.randomize === true,
      countdownHidden: body.countdownHidden === true,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load question set.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}
