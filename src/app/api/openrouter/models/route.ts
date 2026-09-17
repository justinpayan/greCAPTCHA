import { NextResponse } from "next/server";

import { getUserOpenRouterKey } from "@/lib/accounts";
import { getOpenRouterModels } from "@/lib/openrouter";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const models = await getOpenRouterModels(await getUserOpenRouterKey(user.id));
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load models.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
