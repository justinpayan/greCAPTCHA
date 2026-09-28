import { NextResponse } from "next/server";

import { getOpenRouterModels, validateOpenRouterKey } from "@/lib/openrouter";
import { errorResponseBody } from "@/lib/openrouter-errors";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/** The OpenRouter model catalog is public; authentication only protects this app endpoint. */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ models: await getOpenRouterModels() });
  } catch (error) {
    return NextResponse.json(errorResponseBody(error, "Unable to load models."), { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireUser();
    const body = (await request.json()) as {
      openrouterApiKey?: unknown;
      keySource?: unknown;
    };
    const apiKey = String(body.openrouterApiKey ?? "").trim();
    await validateOpenRouterKey(apiKey, { requireSafeguards: body.keySource === "oauth" });
    const models = await getOpenRouterModels(apiKey);
    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(errorResponseBody(error, "Unable to load models."), { status: 502 });
  }
}
