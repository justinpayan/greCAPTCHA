import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { studyTemplates } from "@/db/schema";
import { loadManuscript, ManuscriptTooLargeError, readManuscriptSource } from "@/lib/manuscript-input";
import { persistTemplateMaterial } from "@/lib/manuscripts";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { getTemplate } from "@/lib/templates";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const template = await getTemplate(id, user.id);
    if (template.materialUploader !== "creator") {
      throw new Error("This test is configured for the test taker to upload source material.");
    }
    const form = await request.formData();
    const file = await loadManuscript(readManuscriptSource(form));
    const contributions = String(form.get("contributions") ?? "");
    await persistTemplateMaterial(file, id);
    await db
      .update(studyTemplates)
      .set({
        materialFileName: file.name,
        materialContributions: contributions,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, user.id)))
      .run();
    return NextResponse.json({ saved: true, fileName: file.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save source material.";
    return NextResponse.json(
      { error: message },
      { status: error instanceof ManuscriptTooLargeError ? 413 : 400 },
    );
  }
}
