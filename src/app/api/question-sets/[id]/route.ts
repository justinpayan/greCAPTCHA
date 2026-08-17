import { NextResponse } from "next/server";

import { deleteQuestionSet, renameQuestionSet } from "@/lib/catalog";

export const runtime = "nodejs";

/** Renames a saved set. Its questions, attempts, and answers are untouched. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: unknown };
    const name = await renameQuestionSet(id, String(body.name ?? ""));
    return NextResponse.json({ name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to rename the set.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}

/**
 * Deletes a set together with every attempt on it and every answer in those attempts.
 * Irreversible; the caller is responsible for confirming first.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await deleteQuestionSet(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete the set.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}
