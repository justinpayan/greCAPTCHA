import { NextResponse } from "next/server";

import { assignExperimentPaper, deleteExperiment } from "@/lib/experiments";

export const runtime = "nodejs";

/**
 * Attaches a paper to an experiment created without one, and builds that block's attempt.
 *
 * Researcher-only: the middleware opens `/api/experiments/<id>/session` to participants and nothing
 * else under this path.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      condition?: unknown;
      questionSetId?: unknown;
    };
    const condition = body.condition;
    if (condition !== "own" && condition !== "foreign") {
      throw new Error("Specify which paper to assign: own or foreign.");
    }
    const questionSetId = String(body.questionSetId ?? "").trim();
    if (!questionSetId) throw new Error("Choose a question set to assign.");

    const created = await assignExperimentPaper({
      experimentId: id,
      condition,
      questionSetId,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to assign the paper.";
    return NextResponse.json(
      { error: message },
      { status: message === "Experiment not found." ? 404 : 400 },
    );
  }
}

/** Deletes an experiment and, by cascade, both of its attempts and all of their answers. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await deleteExperiment(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete the experiment.";
    return NextResponse.json(
      { error: message },
      { status: message === "Experiment not found." ? 404 : 400 },
    );
  }
}
