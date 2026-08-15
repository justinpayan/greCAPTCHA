import { NextResponse } from "next/server";

import { getAttemptState } from "@/lib/attempts";

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
