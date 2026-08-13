import { NextResponse } from "next/server";

import { getOpenRouterModels } from "@/lib/openrouter";

export const runtime = "nodejs";

export async function GET() {
  try {
    const models = await getOpenRouterModels();
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load models.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
