import { NextResponse } from "next/server";

import { endpointsForUsername } from "@/lib/llm-endpoints";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

/**
 * The model endpoints the signed-in user may choose between: OpenRouter, plus their institution's
 * if the operator assigned them to one. IDs and display names only, never an address.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(
      { endpoints: endpointsForUsername(user.username) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: publicErrorMessage(error, "Unable to load the model endpoints.") },
      { status: 400 },
    );
  }
}
