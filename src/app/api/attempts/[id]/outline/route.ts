import { NextResponse } from "next/server";

import { getAttemptOutline, requireAttemptOwner } from "@/lib/attempts";
import { enqueueGradingJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
import {
  assertSameOrigin,
  enforceRateLimit,
  rateLimitResponse,
  RateLimitError,
} from "@/lib/security";
import { requireUser } from "@/lib/session";

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
    const user = await requireUser();
    const { id } = await context.params;
    await requireAttemptOwner(id, user.id);
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
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    await requireAttemptOwner(id, user.id);
    await enforceRateLimit(request, "evaluation", user.id, 20, 60 * 60);
    const body = (await request.json()) as {
      openrouterApiKey?: unknown;
      keySource?: unknown;
    };
    const apiKey = String(body.openrouterApiKey ?? "").trim();
    await validateOpenRouterKey(apiKey, { requireSafeguards: body.keySource === "oauth" });
    const grading = await enqueueGradingJob(id, apiKey);
    return NextResponse.json(grading, { status: "result" in grading ? 200 : 202 });
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return errorResponse(error, "Unable to grade the attempt.");
  }
}
