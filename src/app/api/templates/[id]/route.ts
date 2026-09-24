import { NextResponse } from "next/server";

import { deleteTemplate, getTemplate } from "@/lib/templates";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json(
    { error: message },
    { status: message === "Template not found." ? 404 : 400 },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json({ template: await getTemplate(id, user.id) });
  } catch (error) {
    return errorResponse(error, "Unable to load the template.");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteTemplate(id, user.id);
    return NextResponse.json({ deleted: true, ...deleted });
  } catch (error) {
    return errorResponse(error, "Unable to delete the template.");
  }
}
