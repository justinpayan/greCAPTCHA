import { NextResponse } from "next/server";

import { listTakerAttempts } from "@/lib/catalog";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ attempts: await listTakerAttempts(user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list your assessments.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
