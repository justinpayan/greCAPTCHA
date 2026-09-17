import { NextResponse } from "next/server";

import { listAttempts } from "@/lib/catalog";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/** Attempts for the start screen's searchable list, newest first. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ attempts: await listAttempts(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list attempts.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
