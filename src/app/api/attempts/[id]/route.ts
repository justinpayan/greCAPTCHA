import { NextResponse } from "next/server";

import { getAttemptState } from "@/lib/attempts";
import { deleteAttempt } from "@/lib/catalog";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getAttemptState(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load attempt.";
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 400 },
    );
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
    const message = error instanceof Error ? error.message : "Unable to delete the attempt.";
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 400 },
    );
  }
}
