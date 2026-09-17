import { NextResponse } from "next/server";

import {
  deleteQuestionSet,
  getQuestionSetOverview,
  renameQuestionSet,
  setQuestionSetOverallLimit,
} from "@/lib/catalog";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/**
 * A saved set's contents. Researcher-only, like every route outside the participant allowlist:
 * the payload carries card names and generated item descriptions.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json({ overview: await getQuestionSetOverview(id, user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the set.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}

/**
 * Updates a saved set's name, its overall time limit, or both.
 *
 * Each field is applied only when the request actually carries it, so saving one does not clear
 * the other. Questions, answers and attempts already under way are untouched; changing the limit
 * does reach attempts on the set that have not started yet, and the response says how many.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: unknown;
      overallTimeLimitSeconds?: unknown;
    };
    const result: {
      name?: string;
      overallTimeLimitSeconds?: number | null;
      attemptsUpdated?: number;
    } = {};

    if ("name" in body) {
      result.name = await renameQuestionSet(id, String(body.name ?? ""), user.id);
    }
    if ("overallTimeLimitSeconds" in body) {
      const raw = body.overallTimeLimitSeconds;
      if (raw !== null && typeof raw !== "number") {
        throw new Error("The overall limit must be a number of seconds, or null.");
      }
      const applied = await setQuestionSetOverallLimit(id, raw as number | null, user.id);
      result.overallTimeLimitSeconds = applied.overallTimeLimitSeconds;
      result.attemptsUpdated = applied.attemptsUpdated;
    }
    if (Object.keys(result).length === 0) throw new Error("Nothing to update.");

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the set.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}

/**
 * Deletes a set together with every attempt on it and every answer in those attempts.
 * Irreversible; the caller is responsible for confirming first.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await deleteQuestionSet(id, user.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete the set.";
    return NextResponse.json(
      { error: message },
      { status: message === "Question set not found." ? 404 : 400 },
    );
  }
}
