import { NextResponse } from "next/server";

import { retryOwnedJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
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
    const body = (await request.json()) as {
      openrouterApiKey?: unknown;
      keySource?: unknown;
    };
    const apiKey = String(body.openrouterApiKey ?? "").trim();
    if (apiKey) {
      await validateOpenRouterKey(apiKey, { requireSafeguards: body.keySource === "oauth" });
    }
    return NextResponse.json(await retryOwnedJob(id, user.id, apiKey || undefined), {
      status: 202,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retry the job.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
