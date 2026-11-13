import { NextResponse } from "next/server";

import { assertEndpointAllowed } from "@/lib/llm-endpoints";
import { getOpenRouterModels, validateOpenRouterKey } from "@/lib/openrouter";
import { requireOpenRouterCredential } from "@/lib/openrouter-credentials";
import { errorResponseBody } from "@/lib/openrouter-errors";
import { endpointIdSchema } from "@/lib/quiz";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/**
 * The model catalog for `?endpoint=` (OpenRouter when absent). OpenRouter's is public;
 * authentication only protects this app endpoint. An institution's lists only what a key may call,
 * so it is read with the user's stored key for it (or the group's catalog key).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const endpoint = endpointIdSchema.parse(
      new URL(request.url).searchParams.get("endpoint") ?? "openrouter",
    );
    assertEndpointAllowed(user.username, endpoint);
    const storedKey =
      endpoint === "openrouter"
        ? undefined
        : await requireOpenRouterCredential(user.id, endpoint).catch(() => undefined);
    return NextResponse.json({ models: await getOpenRouterModels(storedKey, endpoint) });
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
