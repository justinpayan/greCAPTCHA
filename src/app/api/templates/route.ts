import { NextResponse } from "next/server";

import { studyTemplateConfigSchema, workflowTypeSchema } from "@/lib/quiz";
import { requireUser } from "@/lib/session";
import { getDraft, listTemplates, saveDraft, saveTemplate } from "@/lib/templates";

export const runtime = "nodejs";

/** One call for the start screen: every saved template plus the autosaved draft. */
export async function GET() {
  try {
    const user = await requireUser();
    const [templates, draft] = await Promise.all([listTemplates(user.id), getDraft(user.id)]);
    return NextResponse.json({ templates, draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load templates.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Save a named template. An existing name is replaced rather than duplicated. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      name?: unknown;
      config?: unknown;
      workflowType?: unknown;
    };
    const config = studyTemplateConfigSchema.parse(body.config);
    const workflowType = workflowTypeSchema.parse(body.workflowType ?? "course");
    const saved = await saveTemplate(user.id, String(body.name ?? ""), config, workflowType);
    return NextResponse.json({ template: saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the template.";
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
    const message = error instanceof Error ? error.message : "Unable to save the draft.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
