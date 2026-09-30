import { NextResponse } from "next/server";

import { getInvitationJob } from "@/lib/jobs";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json({ job: await getInvitationJob(id, user.id) });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load generation.");
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
