import { NextResponse } from "next/server";

import { getConferenceJob } from "@/lib/jobs";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json({ job: await getConferenceJob(id, user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load generation.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
