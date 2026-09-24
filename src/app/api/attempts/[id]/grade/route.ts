import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attempts, questionSets } from "@/db/schema";
import { requireOpenAttempt } from "@/lib/attempt-access";
import { enqueueGradingJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
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
        workflowType: questionSets.workflowType,
        takerUserId: attempts.takerUserId,
      })
      .from(attempts)
      .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
      .where(eq(attempts.id, id))
      .get();
    if (!attempt || attempt.takerUserId !== user.id) {
      throw new Error("Only the examinee can submit a conference grading key.");
    }
    if (attempt.workflowType !== "conference") {
      throw new Error("Course assessments use the professor's registered grading key.");
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
    const message = error instanceof Error ? error.message : "Unable to grade the assessment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
