import { NextResponse } from "next/server";
import { z } from "zod";

import { listQuestionSets } from "@/lib/catalog";
import { enqueueGenerationJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
import { requireOpenRouterCredential } from "@/lib/openrouter-credentials";
import {
  MAX_PDF_BYTES,
  MAX_UPLOAD_BYTES,
  pdfTooLargeMessage,
  uploadTooLargeMessage,
} from "@/lib/uploads";
import { requireUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import {
  generationConfigSchema,
  pdfEngineSchema,
  workflowTypeSchema,
} from "@/lib/quiz";
import { getTemplate } from "@/lib/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Saved sets for the start screen's searchable list. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ sets: await listQuestionSets(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list question sets.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * Refusal for an upload that is too big to be read, thrown before the body is touched.
 *
 * Carries its own status because 413 is the honest answer and the catch-all below would
 * otherwise report a size problem as a 400 alongside every validation error.
 */
class UploadTooLargeError extends Error {}

/**
 * Reads the multipart form, turning "too big" into something a researcher can act on.
 *
 * Two guards, because the failure has two shapes. `Content-Length` is checked first and is the
 * useful one: it is known before a single byte of body is parsed, so an oversized upload is
 * refused with its actual size named. The parse itself is then wrapped, because a body that
 * arrives without a length header — or is truncated by a proxy in front of this server — reaches
 * `formData()` and fails there, and Next's own "Failed to parse body as FormData" is the cryptic
 * message this exists to replace.
 *
 * The browser checks the file before uploading, so in practice this is the backstop for direct
 * API callers and for a form filled in with an unusually long contributions statement.
 */
async function readUploadForm(request: Request): Promise<FormData> {
  const declared = Number(request.headers.get("content-length"));
  const declaredBytes = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (declaredBytes !== null && declaredBytes > MAX_UPLOAD_BYTES) {
    throw new UploadTooLargeError(uploadTooLargeMessage(declaredBytes));
  }
  try {
    return await request.formData();
  } catch {
    // A declared length that fitted the budget rules truncation out: the body was genuinely
    // malformed, and calling that "too large" would send the researcher after the wrong problem.
    if (declaredBytes !== null) {
      throw new Error(
        "The upload could not be read. Send the form again, and if it keeps failing, re-save the PDF.",
      );
    }
    // No length header, so the size is unknown and truncation is the likely cause — that is the
    // shape a chunked upload past the cap arrives in.
    throw new UploadTooLargeError(uploadTooLargeMessage(null));
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const form = await readUploadForm(request);

    // The PDF is checked first, ahead of every other field. A manuscript that is too big is the
    // one problem the researcher has already spent an upload on, and hearing about a mis-set
    // block count instead would send them looking in the wrong place.
    const file = form.get("paper");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF manuscript.");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF files are supported.");
    }
    // Reachable only in the narrow band where the whole body fits the budget but the PDF alone is
    // over its share of it. The browser applies the same ceiling before uploading.
    if (file.size > MAX_PDF_BYTES) throw new UploadTooLargeError(pdfTooLargeMessage(file.size));

    const contributions = String(form.get("contributions") ?? "").trim();
    const workflowType = workflowTypeSchema.parse(form.get("workflowType") ?? "course");
    if (workflowType !== "course") {
      throw new Error("Conference question sets must be created from an examinee invitation.");
    }
    const sourceTemplateId = String(form.get("sourceTemplateId") ?? "").trim() || null;
    if (sourceTemplateId) {
      const template = await getTemplate(sourceTemplateId, user.id);
      if (template.workflowType !== workflowType) {
        throw new Error("The selected template does not match this workflow.");
      }
    }
    const apiKey = await requireOpenRouterCredential(user.id);
    await validateOpenRouterKey(apiKey, { requireSafeguards: true });
    const setName = String(form.get("name") ?? "").trim().slice(0, 120);
    const modelId = String(form.get("modelId") ?? "").trim();
    const pdfEngine = pdfEngineSchema.parse(form.get("pdfEngine"));
    const randomize = form.get("randomize") === "true";
    const countdownHidden = form.get("countdownHidden") === "true";
    const overallRaw = String(form.get("overallTimeLimitSeconds") ?? "").trim();
    const overallTimeLimitSeconds = overallRaw
      ? z.number().int().min(30).max(21_600).parse(Number(overallRaw))
      : null;
    const blocks = generationConfigSchema.parse(
      JSON.parse(String(form.get("blocks") ?? "[]")),
    );

    // No length check at all, in either direction. A statement is passed to the generator as
    // written, so the model's context window is the only ceiling and an over-long one fails with
    // the model's own error rather than one invented here. Blank is allowed too: the generator is
    // told there is no declared scope and covers the whole manuscript.
    if (blocks.reduce((sum, block) => sum + block.count, 0) > 50) {
      throw new Error("A question set may contain at most 50 questions.");
    }

    const signature = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("ascii");
    if (signature !== "%PDF-") throw new Error("The selected file is not a valid PDF.");

    const created = await enqueueGenerationJob(user.id, file, {
      setName,
      sourceTemplateId,
      workflowType,
      contributions,
      modelId,
      pdfEngine,
      randomize,
      countdownHidden,
      overallTimeLimitSeconds,
      blocks,
    }, apiKey);
    return NextResponse.json(created, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Question generation failed.";
    // 413 for a size refusal, so a caller that is not this app's own form can tell an upload
    // that was too big apart from a form that was filled in wrongly.
    const status = error instanceof UploadTooLargeError ? 413 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
