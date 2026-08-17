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
    return NextResponse.json({ experiments, allocation });
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
    const ownQuestionSetId = String(body.ownQuestionSetId ?? "").trim();
    const foreignQuestionSetId = String(body.foreignQuestionSetId ?? "").trim();
    if (!ownQuestionSetId || !foreignQuestionSetId) {
      throw new Error("Choose a question set for each paper.");
    }

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
