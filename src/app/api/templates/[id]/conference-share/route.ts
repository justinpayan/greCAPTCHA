import { NextResponse } from "next/server";

import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { setConferenceTemplateSharing } from "@/lib/templates";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const body = (await request.json()) as { enabled?: unknown };
    const result = await setConferenceTemplateSharing(id, user.id, body.enabled === true);
    return NextResponse.json({
      ...result,
      participantPath: result.conferenceShareToken
        ? `/conference/${result.conferenceShareToken}`
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update sharing.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
