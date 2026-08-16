import { NextResponse } from "next/server";

import { renameQuestionSet } from "@/lib/catalog";

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
