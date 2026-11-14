import { NextResponse } from "next/server";

import { CodeBundleTooLargeError } from "@/lib/code-bundle";
import { codebaseListing, readCodebaseSource, unpackCodebase } from "@/lib/codebase-input";
import { ManuscriptTooLargeError } from "@/lib/manuscript-input";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

/**
 * Lists a codebase's files for the "Which parts of the code did you write?" picker: the ZIP or
 * repository is unpacked and filtered exactly as it is on submission, so the picker offers the
 * files the model will see and nothing else. Nothing is stored; a repository listing returns the
 * commit it came from, and the form pins the submission to it.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireUser();
    const form = await request.formData();
    const bundle = await unpackCodebase(readCodebaseSource(form));
    return NextResponse.json(codebaseListing(bundle));
  } catch (error) {
    const tooLarge = error instanceof CodeBundleTooLargeError || error instanceof ManuscriptTooLargeError;
    return NextResponse.json(
      { error: publicErrorMessage(error, "Unable to list the codebase's files.") },
      { status: tooLarge ? 413 : 400 },
    );
  }
}
