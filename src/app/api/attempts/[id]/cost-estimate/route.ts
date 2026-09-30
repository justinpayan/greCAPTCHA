import { NextResponse } from "next/server";

import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { attemptGradingCostEstimate } from "@/lib/cost-estimate";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

/**
 * The model and estimated OpenRouter cost of grading this attempt, shown to a test taker before
 * they supply their own key. Fetched once by the grading screens, not polled.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    // The same guard as the grading status: only the attempt's taker or its creator.
    await requireOpenAttempt(id);
    return NextResponse.json({ estimate: await attemptGradingCostEstimate(id) });
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json({ error: error.message, locked: true }, { status: 403 });
    }
    const message = publicErrorMessage(error, "Unable to estimate the cost.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
