import { NextResponse } from "next/server";

import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { closeForTimeout, overallBudget } from "@/lib/attempt-close";
import { submitAttempt } from "@/lib/attempt-submit";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireOpenAttempt(id);
    if ((await overallBudget(id)).exhausted) {
      return NextResponse.json(await closeForTimeout(id), { status: 202 });
    }
    return NextResponse.json(await submitAttempt(id, "manual"), { status: 202 });
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json(
        { error: error.message, locked: true, paused: error.paused },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to submit assessment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
