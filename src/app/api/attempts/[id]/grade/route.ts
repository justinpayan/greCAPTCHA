import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attempts, questionSets } from "@/db/schema";
import { requireOpenAttempt } from "@/lib/attempt-access";
import { enqueueGradingJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
import { errorResponseBody } from "@/lib/openrouter-errors";
import { assertSameOrigin, enforceRateLimit } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    await requireOpenAttempt(id);
    await enforceRateLimit(request, "evaluation", user.id, 20, 60 * 60);
    const attempt = await db
      .select({
        status: attempts.status,
        apiKeyPayer: questionSets.apiKeyPayer,
        takerUserId: attempts.takerUserId,
      })
      .from(attempts)
      .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
      .where(eq(attempts.id, id))
      .get();
    if (!attempt || attempt.takerUserId !== user.id) {
      throw new Error("Only the test taker can submit a grading key.");
    }
    if (attempt.apiKeyPayer !== "taker") {
      throw new Error("This assessment uses the test creator's registered grading key.");
    }
    if (attempt.status !== "submitted" && attempt.status !== "graded") {
      throw new Error("Finish the assessment before grading it.");
    }
    const body = (await request.json()) as {
      openrouterApiKey?: unknown;
      keySource?: unknown;
    };
    const apiKey = String(body.openrouterApiKey ?? "").trim();
    await validateOpenRouterKey(apiKey, { requireSafeguards: body.keySource === "oauth" });
    const grading = await enqueueGradingJob(id, { apiKey });
    return NextResponse.json(grading, { status: "result" in grading ? 200 : 202 });
  } catch (error) {
    return NextResponse.json(errorResponseBody(error, "Unable to grade the assessment."), {
      status: 400,
    });
  }
}
