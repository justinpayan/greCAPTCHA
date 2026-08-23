import { NextResponse } from "next/server";

import { createExperiment, experimentAllocation, listExperiments } from "@/lib/experiments";

export const runtime = "nodejs";

/**
 * Researcher-only, like every route outside the participant allowlist: an experiment payload
 * names both papers and the condition each attempt belongs to.
 */
export async function GET() {
  try {
    const [experiments, allocation] = await Promise.all([
      listExperiments(),
      experimentAllocation(),
    ]);
    // Same source as the plan page's participant link: the researcher may be on localhost
    // while participants reach the app through a tunnel.
    const participantBaseUrl = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
    return NextResponse.json({ experiments, allocation, participantBaseUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list experiments.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Creates an experiment: a participant ID, two attempts, and a counterbalanced order. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      ownQuestionSetId?: unknown;
      foreignQuestionSetId?: unknown;
      randomize?: unknown;
      countdownHidden?: unknown;
    };
    // Either paper may be omitted: the experiment then reserves the participant ID and its
    // allocation, and each block's bank is attached later through PATCH.
    const ownQuestionSetId = String(body.ownQuestionSetId ?? "").trim() || null;
    const foreignQuestionSetId = String(body.foreignQuestionSetId ?? "").trim() || null;

    const created = await createExperiment({
      ownQuestionSetId,
      foreignQuestionSetId,
      randomize: body.randomize === true,
      countdownHidden: body.countdownHidden === true,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the experiment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
