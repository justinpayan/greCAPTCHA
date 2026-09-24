import { NextResponse } from "next/server";

import { listCreatedTests } from "@/lib/catalog";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/** Creator-owned Course tests and Conference invitations with their child attempts. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ tests: await listCreatedTests(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list created tests.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
