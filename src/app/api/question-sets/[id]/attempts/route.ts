import { NextResponse } from "next/server";

import { createAttempt } from "@/lib/attempts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { randomize?: unknown };
    const state = await createAttempt(id, body.randomize === true);
    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load question set.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}
