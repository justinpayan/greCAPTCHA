import fs from "node:fs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attempts } from "@/db/schema";
import { requireOpenAttempt } from "@/lib/attempt-access";
import { manuscriptPath } from "@/lib/manuscripts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    // The same guard used by the assessment lets only its owner or assigned taker read the paper.
    await requireOpenAttempt(id);
    const attempt = await db
      .select({ questionSetId: attempts.questionSetId })
      .from(attempts)
      .where(eq(attempts.id, id))
      .get();
    if (!attempt) throw new Error("Attempt not found.");

    const filePath = manuscriptPath(attempt.questionSetId);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "The manuscript PDF is unavailable." }, { status: 404 });
    }
    const bytes = fs.readFileSync(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'inline; filename="manuscript.pdf"',
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the manuscript PDF.";
    return NextResponse.json(
      { error: message },
      { status: message === "Attempt not found." ? 404 : 403 },
    );
  }
}
