import { NextResponse } from "next/server";

import {
  credentialStatus,
  deleteOpenRouterCredential,
  saveOpenRouterCredential,
} from "@/lib/openrouter-credentials";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await credentialStatus(user.id));
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load OpenRouter status.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = (await request.json()) as { openrouterApiKey?: unknown };
    const status = await saveOpenRouterCredential(
      user.id,
      String(body.openrouterApiKey ?? ""),
    );
    return NextResponse.json(status);
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to connect OpenRouter.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await deleteOpenRouterCredential(user.id);
    return NextResponse.json({ connected: false });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to disconnect OpenRouter.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
