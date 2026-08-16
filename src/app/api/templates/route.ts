import { NextResponse } from "next/server";

import { studyTemplateConfigSchema } from "@/lib/quiz";
import { getDraft, listTemplates, saveDraft, saveTemplate } from "@/lib/templates";

export const runtime = "nodejs";

/** One call for the start screen: every saved template plus the autosaved draft. */
export async function GET() {
  try {
    const [templates, draft] = await Promise.all([listTemplates(), getDraft()]);
    return NextResponse.json({ templates, draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load templates.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Save a named template. An existing name is replaced rather than duplicated. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: unknown; config?: unknown };
    const config = studyTemplateConfigSchema.parse(body.config);
    const saved = await saveTemplate(String(body.name ?? ""), config);
    return NextResponse.json({ template: saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the template.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Autosave the working config. Overwrites the single stored draft. */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { config?: unknown };
    await saveDraft(studyTemplateConfigSchema.parse(body.config));
    return NextResponse.json({ saved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the draft.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
