import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { conferenceSubmissions } from "@/db/schema";
import { enqueueGenerationJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
import { requireOpenRouterCredential, saveConferenceCredential } from "@/lib/openrouter-credentials";
import { errorResponseBody } from "@/lib/openrouter-errors";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { readTemplateMaterial } from "@/lib/manuscripts";
import {
  AssessmentNotAllowedError,
  isAssessmentNotAllowedError,
  isUsernameAllowed,
} from "@/lib/allowlist";
import { getTemplateByInvitationToken } from "@/lib/templates";
import { loadManuscript, readManuscriptSource } from "@/lib/manuscript-input";
import { applyCodeScope, bundleUpload, loadCodebase, readCodebaseSource } from "@/lib/codebase-input";
import { endpointOf, materialKindOf } from "@/lib/quiz";
import { assertEndpointAllowedForUserId } from "@/lib/llm-endpoints";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const user = await requireUser();
    const { token } = await context.params;
    const template = await getTemplateByInvitationToken(token);
    if (
      template.ownerUserId !== user.id &&
      !isUsernameAllowed(user.username, template.takerAllowlist)
    ) {
      throw new AssessmentNotAllowedError(user.username);
    }
    return NextResponse.json({
      template: {
        modelId: template.config.modelId,
        pdfEngine: template.config.pdfEngine,
        questionCount: template.config.blocks.reduce((sum, block) => sum + block.count, 0),
        apiKeyPayer: template.apiKeyPayer,
        materialUploader: template.materialUploader,
        materialFileName: template.materialFileName,
      },
    });
  } catch (error) {
    if (isAssessmentNotAllowedError(error)) {
      return NextResponse.json(
        { error: error.message, notAllowed: true, username: error.username },
        { status: 403 },
      );
    }
    const message = publicErrorMessage(error, "Unable to load the invitation.");
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
    const template = await getTemplateByInvitationToken(token);
    if (
      template.ownerUserId !== user.id &&
      !isUsernameAllowed(user.username, template.takerAllowlist)
    ) {
      throw new AssessmentNotAllowedError(user.username);
    }
    if (!template.config.modelId || template.config.blocks.length === 0) {
      throw new Error("This invitation is not ready for generation.");
    }

    const form = await request.formData();
    let contributions =
      template.materialUploader === "taker"
        ? String(form.get("contributions") ?? "").trim()
        : template.materialContributions ?? "";
    let apiKey: string | undefined;
    let credentialOwnerUserId: string | undefined;
    // An institution endpoint is paid for by the creator's stored key, never by takers, and only
    // while the creator is still assigned to it.
    const endpoint = endpointOf(template.config);
    if (endpoint !== "openrouter") {
      if (template.apiKeyPayer === "taker") {
        throw new Error("This invitation is misconfigured: its creator must pay for its model endpoint.");
      }
      assertEndpointAllowedForUserId(template.ownerUserId, endpoint);
    }
    if (template.apiKeyPayer === "taker") {
      apiKey = String(form.get("openrouterApiKey") ?? "").trim();
      const keySource = form.get("keySource") === "oauth" ? "oauth" : "paste";
      if (!template.config.requireSeb) {
        await validateOpenRouterKey(apiKey, { requireSafeguards: keySource === "oauth" });
      }
    } else {
      await requireOpenRouterCredential(template.ownerUserId, endpoint);
      credentialOwnerUserId = template.ownerUserId;
    }
    const materialKind = materialKindOf(template.config);
    const loadTakerCode = async () => {
      const bundle = await loadCodebase(readCodebaseSource(form), template.config.modelId, {
        apiKey,
        endpoint,
      });
      const scoped = applyCodeScope(bundle, form);
      if (scoped) contributions = scoped.contributions;
      return bundleUpload(scoped?.bundle ?? bundle);
    };
    const file =
      template.materialUploader === "taker"
        ? materialKind === "code"
          ? await loadTakerCode()
          : await loadManuscript(readManuscriptSource(form))
        : materialKind === "code"
          ? new File(
              [new Uint8Array(readTemplateMaterial(template.id, "code"))],
              template.materialFileName ?? "codebase",
              { type: "application/json" },
            )
          : new File(
              [new Uint8Array(readTemplateMaterial(template.id))],
              template.materialFileName ?? "source-material.pdf",
              { type: "application/pdf" },
            );

    const now = new Date().toISOString();
    await db.insert(conferenceSubmissions).values({
      id: submissionId,
      templateId: template.id,
      administratorUserId: template.ownerUserId,
      takerUserId: user.id,
      paperName: file.name,
      contributions,
      requireSeb: template.config.requireSeb ?? false,
      apiKeyPayer: template.apiKeyPayer,
      createdAt: now,
      updatedAt: now,
    });
    const conferenceCredentialId = template.config.requireSeb && template.apiKeyPayer === "taker"
      ? submissionId : undefined;
    if (conferenceCredentialId) {
      await saveConferenceCredential(conferenceCredentialId, apiKey ?? "");
      apiKey = undefined;
    }

    const created = await enqueueGenerationJob(
      user.id,
      file,
      {
        materialKind,
        endpoint,
        questionSetOwnerUserId: template.ownerUserId,
        sourceTemplateId: template.id,
        apiKeyPayer: template.apiKeyPayer,
        materialUploader: template.materialUploader,
        credentialOwnerUserId,
        conferenceCredentialId,
        conferenceSubmissionId: submissionId,
        taker: { id: user.id, username: user.username },
        setName: file.name.replace(/\.(pdf|zip)$/i, ""),
        contributions,
        modelId: template.config.modelId,
        pdfEngine: template.config.pdfEngine,
        randomize: false,
        overallTimeLimitSeconds: template.config.overallTimeLimitSeconds,
        gradingInstructions: template.config.gradingInstructions,
        blocks: template.config.blocks,
        takerAllowlist: template.takerAllowlist,
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
    if (isAssessmentNotAllowedError(error)) {
      return NextResponse.json(
        { error: error.message, notAllowed: true, username: error.username },
        { status: 403 },
      );
    }
    return NextResponse.json(errorResponseBody(error, "Unable to generate the assessment."), {
      status: 400,
    });
  }
}
