import { NextResponse } from "next/server";

import { assertEndpointAllowed } from "@/lib/llm-endpoints";
import {
  credentialStatus,
  deleteOpenRouterCredential,
  saveOpenRouterCredential,
} from "@/lib/openrouter-credentials";
import { endpointIdSchema } from "@/lib/quiz";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

/**
 * The creator's stored key for one endpoint (`?endpoint=`, or `endpoint` in the body; OpenRouter
 * when absent). A creator may store one key per endpoint, and only for endpoints they may use.
 */
function endpointFor(username: string, value: unknown): string {
  const endpoint = endpointIdSchema.parse(value ?? "openrouter");
  assertEndpointAllowed(username, endpoint);
  return endpoint;
}

const queryEndpoint = (request: Request) =>
  new URL(request.url).searchParams.get("endpoint") ?? undefined;

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(
      await credentialStatus(user.id, endpointFor(user.username, queryEndpoint(request))),
    );
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load the API key status.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = (await request.json()) as { openrouterApiKey?: unknown; endpoint?: unknown };
    const status = await saveOpenRouterCredential(
      user.id,
      String(body.openrouterApiKey ?? ""),
      endpointFor(user.username, body.endpoint),
    );
    return NextResponse.json(status);
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to save the API key.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await deleteOpenRouterCredential(user.id, endpointFor(user.username, queryEndpoint(request)));
    return NextResponse.json({ connected: false });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to disconnect the API key.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
