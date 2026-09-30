import { NextResponse } from "next/server";

import { getOwnedJob } from "@/lib/jobs";
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
    return NextResponse.json({ job: await getOwnedJob(id, user.id) });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load the job.");
    return NextResponse.json(
      { error: message },
      { status: message === "Job not found." ? 404 : message === "Not authorised." ? 401 : 400 },
    );
  }
}
