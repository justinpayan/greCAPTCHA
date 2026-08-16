import { NextResponse } from "next/server";

import { listAttempts } from "@/lib/catalog";

export const runtime = "nodejs";

/** Attempts for the start screen's searchable list, newest first. */
export async function GET() {
  try {
    return NextResponse.json({ attempts: await listAttempts() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list attempts.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
