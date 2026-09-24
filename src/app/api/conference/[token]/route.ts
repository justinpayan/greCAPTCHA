import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { conferenceSubmissions } from "@/db/schema";
import { enqueueGenerationJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { getConferenceTemplateByToken } from "@/lib/templates";
import { MAX_PDF_BYTES, pdfTooLargeMessage } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    await requireUser();
    const { token } = await context.params;
    const template = await getConferenceTemplateByToken(token);
    return NextResponse.json({
      template: {
        name: template.name,
        modelId: template.config.modelId,
        pdfEngine: template.config.pdfEngine,
        questionCount: template.config.blocks.reduce((sum, block) => sum + block.count, 0),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the invitation.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const submissionId = randomUUID();
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { token } = await context.params;
    const template = await getConferenceTemplateByToken(token);
    if (!template.config.modelId || template.config.blocks.length === 0) {
      throw new Error("This conference template is not ready for generation.");
    }

    const form = await request.formData();
    const file = form.get("paper");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF manuscript.");
    if (file.size > MAX_PDF_BYTES) throw new Error(pdfTooLargeMessage(file.size));
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF files are supported.");
    }
    const signature = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("ascii");
    if (signature !== "%PDF-") throw new Error("The selected file is not a valid PDF.");

    const contributions = String(form.get("contributions") ?? "").trim();
    const apiKey = String(form.get("openrouterApiKey") ?? "").trim();
    const keySource = form.get("keySource") === "oauth" ? "oauth" : "paste";
    await validateOpenRouterKey(apiKey, { requireSafeguards: keySource === "oauth" });

    const now = new Date().toISOString();
    await db.insert(conferenceSubmissions).values({
      id: submissionId,
      templateId: template.id,
      assessorUserId: template.ownerUserId,
      takerUserId: user.id,
      paperName: file.name,
      contributions,
      createdAt: now,
      updatedAt: now,
    });

    const created = await enqueueGenerationJob(
      user.id,
      file,
      {
        questionSetOwnerUserId: template.ownerUserId,
        sourceTemplateId: template.id,
        workflowType: "conference",
        conferenceSubmissionId: submissionId,
        taker: { id: user.id, username: user.username },
        setName: file.name.replace(/\.pdf$/i, ""),
        contributions,
        modelId: template.config.modelId,
        pdfEngine: template.config.pdfEngine,
        randomize: template.config.randomize,
        countdownHidden: template.config.countdownHidden,
        overallTimeLimitSeconds: template.config.overallTimeLimitSeconds,
        blocks: template.config.blocks,
      },
      apiKey,
    );
    await db
      .update(conferenceSubmissions)
      .set({ generationJobId: created.jobId, updatedAt: new Date().toISOString() })
      .where(eq(conferenceSubmissions.id, submissionId))
      .run();
    return NextResponse.json(
      { submissionId, jobId: created.jobId },
      { status: 202 },
    );
  } catch (error) {
    try {
      await db
        .delete(conferenceSubmissions)
        .where(eq(conferenceSubmissions.id, submissionId))
        .run();
    } catch {
      // Preserve the original generation error if cleanup itself fails.
    }
    const message = error instanceof Error ? error.message : "Unable to generate the assessment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
