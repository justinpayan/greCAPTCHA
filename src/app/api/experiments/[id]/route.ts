import { NextResponse } from "next/server";

import { deleteExperiment } from "@/lib/experiments";

export const runtime = "nodejs";

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
