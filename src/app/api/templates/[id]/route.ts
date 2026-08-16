import { NextResponse } from "next/server";

import { deleteTemplate, getTemplate } from "@/lib/templates";

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
    const { id } = await context.params;
    return NextResponse.json({ template: await getTemplate(id) });
  } catch (error) {
    return errorResponse(error, "Unable to load the template.");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await deleteTemplate(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error, "Unable to delete the template.");
  }
}
