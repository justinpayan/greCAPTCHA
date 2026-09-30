import { NextResponse } from "next/server";

import { parseAllowlist } from "@/lib/allowlist";
import {
  apiKeyPayerSchema,
  materialUploaderSchema,
  studyTemplateConfigSchema,
} from "@/lib/quiz";
import { requireUser } from "@/lib/session";
import { getDraft, listTemplates, saveDraft, saveTemplate } from "@/lib/templates";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

/** One call for the start screen: every saved template plus the autosaved draft. */
export async function GET() {
  try {
    const user = await requireUser();
    const [templates, draft] = await Promise.all([listTemplates(user.id), getDraft(user.id)]);
    return NextResponse.json({ templates, draft });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load templates.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Creates a named template or updates the explicitly selected one. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      name?: unknown;
      config?: unknown;
      apiKeyPayer?: unknown;
      materialUploader?: unknown;
      templateId?: unknown;
      allowlist?: unknown;
    };
    const config = studyTemplateConfigSchema.parse(body.config);
    const apiKeyPayer = apiKeyPayerSchema.parse(body.apiKeyPayer ?? "creator");
    const materialUploader = materialUploaderSchema.parse(
      body.materialUploader ?? "creator",
    );
    const saved = await saveTemplate(
      user.id,
      String(body.name ?? ""),
      config,
      apiKeyPayer,
      materialUploader,
      body.templateId ? String(body.templateId) : null,
      "allowlist" in body ? parseAllowlist(body.allowlist) : undefined,
    );
    return NextResponse.json({ template: saved }, { status: 201 });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to save the template.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Autosave the working config. Overwrites the single stored draft. */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { config?: unknown };
    await saveDraft(user.id, studyTemplateConfigSchema.parse(body.config));
    return NextResponse.json({ saved: true });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to save the draft.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
