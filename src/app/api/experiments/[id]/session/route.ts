import { NextResponse } from "next/server";

import { getExperimentSession } from "@/lib/experiments";

export const runtime = "nodejs";

/**
 * The block order behind a chained participant link.
 *
 * Participant-facing, and the only experiment route that is: `/api/experiments` and the DELETE
 * on `/api/experiments/<id>` stay behind the password. The payload is attempt IDs and positions
 * only — no condition, no paper names, no participant ID — and each attempt still gates itself
 * on its own link switch, so this grants exactly what holding both individual links would.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ session: await getExperimentSession(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open this session.";
    return NextResponse.json(
      { error: message },
      { status: message === "Experiment not found." ? 404 : 400 },
    );
  }
}
