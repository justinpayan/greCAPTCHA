import { NextResponse } from "next/server";

import { createAttempt } from "@/lib/attempts";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

/**
 * Creates an attempt and returns its ID only. No question is served here; attempts are often
 * created days before the session. The link is created closed.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await request.json().catch(() => ({}));
    const created = await createAttempt({
      questionSetId: id,
      ownerUserId: user.id,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load question set.");
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}
