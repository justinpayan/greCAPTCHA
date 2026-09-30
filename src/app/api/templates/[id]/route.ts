import { NextResponse } from "next/server";

import { parseAllowlist } from "@/lib/allowlist";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { deleteTemplate, getTemplate, setTemplateAllowlist } from "@/lib/templates";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

function errorResponse(error: unknown, fallback: string) {
  const message = publicErrorMessage(error, fallback);
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const body = (await request.json()) as { allowlist?: unknown };
    if (!("allowlist" in body)) throw new Error("Nothing to update.");
    return NextResponse.json({
      allowlist: await setTemplateAllowlist(id, user.id, parseAllowlist(body.allowlist)),
    });
  } catch (error) {
    return errorResponse(error, "Unable to update the template.");
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
