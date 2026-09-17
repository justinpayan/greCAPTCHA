import { NextResponse } from "next/server";

import { updateUserOpenRouterKey } from "@/lib/accounts";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { openrouterApiKey?: unknown };
    await updateUserOpenRouterKey(user.id, String(body.openrouterApiKey ?? ""));
    return NextResponse.json({ updated: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the API key.";
    return NextResponse.json(
      { error: message },
      { status: message === "Not authorised." ? 401 : 400 },
    );
  }
}
