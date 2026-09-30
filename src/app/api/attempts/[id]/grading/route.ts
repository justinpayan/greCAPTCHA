import { NextResponse } from "next/server";

import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { getAttemptGradingJob } from "@/lib/jobs";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireOpenAttempt(id);
    return NextResponse.json(await getAttemptGradingJob(id));
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json({ error: error.message, locked: true }, { status: 403 });
    }
    const message = publicErrorMessage(error, "Unable to check grading.");
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 400 },
    );
  }
}
