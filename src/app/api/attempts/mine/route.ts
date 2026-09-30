import { NextResponse } from "next/server";

import { listTakerAttempts } from "@/lib/catalog";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ attempts: await listTakerAttempts(user.id) });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to list your assessments.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
