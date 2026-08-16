import { NextResponse } from "next/server";

import { getAttemptOutline } from "@/lib/attempts";
import { ensureGraded } from "@/lib/grading";

export const runtime = "nodejs";
export const maxDuration = 300;

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json(
    { error: message },
    { status: message === "Attempt not found." ? 404 : 400 },
  );
}

/** The researcher-facing plan of an attempt. Never requested by the test-taking screens. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ outline: await getAttemptOutline(id) });
  } catch (error) {
    return errorResponse(error, "Unable to load the attempt summary.");
  }
}

/**
 * Grades a fully answered attempt and returns the result, or returns the stored result if
 * it is already graded. Lets the summary page recover an attempt whose grading call failed.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ result: await ensureGraded(id) });
  } catch (error) {
    return errorResponse(error, "Unable to grade the attempt.");
  }
}
