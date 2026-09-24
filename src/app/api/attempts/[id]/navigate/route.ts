import { NextResponse } from "next/server";
import { z } from "zod";

import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { closeForTimeout, overallBudget } from "@/lib/attempt-close";
import { navigateAttempt } from "@/lib/attempts";

export const runtime = "nodejs";

const navigationSchema = z.object({ index: z.number().int().min(0) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { index } = navigationSchema.parse(await request.json());
    await requireOpenAttempt(id);
    if ((await overallBudget(id)).exhausted) {
      return NextResponse.json(await closeForTimeout(id), { status: 202 });
    }
    return NextResponse.json(await navigateAttempt(id, index));
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json(
        { error: error.message, locked: true, paused: error.paused },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to open question.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
