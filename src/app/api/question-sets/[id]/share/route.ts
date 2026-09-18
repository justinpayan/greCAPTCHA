import { NextResponse } from "next/server";

import { createSharedAttempt } from "@/lib/attempts";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const shared = await createSharedAttempt(id, user.id);
    return NextResponse.json(shared, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create an assessment link.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}
