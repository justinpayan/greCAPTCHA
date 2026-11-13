import fs from "node:fs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attempts, questionSets } from "@/db/schema";
import { requireOpenAttempt } from "@/lib/attempt-access";
import { parseBundle } from "@/lib/code-bundle";
import { manuscriptPath, readManuscript } from "@/lib/manuscripts";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

/**
 * The codebase a set was generated from, for the participant's code viewer: the same filtered,
 * redacted files the model saw, so the participant reads exactly what the questions were based on.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    // The guard the PDF uses: only the attempt's owner or assigned taker may read its material.
    await requireOpenAttempt(id);
    const row = await db
      .select({ questionSetId: attempts.questionSetId, materialKind: questionSets.materialKind })
      .from(attempts)
      .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
      .where(eq(attempts.id, id))
      .get();
    if (!row) throw new Error("Attempt not found.");
    if (row.materialKind !== "code" || !fs.existsSync(manuscriptPath(row.questionSetId, "code"))) {
      return NextResponse.json({ error: "The codebase is unavailable." }, { status: 404 });
    }
    const bundle = parseBundle(readManuscript(row.questionSetId, "code"));
    return NextResponse.json(
      { name: bundle.name, files: bundle.files, skipped: bundle.skipped },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load the codebase.");
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 403 },
    );
  }
}
