import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attemptFeedback, attempts } from "@/db/schema";
import { requireOpenAttempt } from "@/lib/attempt-access";
import { assertSameOrigin } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

async function requireFeedbackSubmitter(attemptId: string, userId: string) {
  await requireOpenAttempt(attemptId);
  const attempt = await db
    .select({
      status: attempts.status,
      takerUserId: attempts.takerUserId,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .get();
  if (!attempt || attempt.takerUserId !== userId) {
    throw new Error("Only the examinee can submit feedback.");
  }
  if (attempt.status !== "graded") {
    throw new Error("Feedback opens after grading is complete.");
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await requireFeedbackSubmitter(id, user.id);
    const feedback = await db
      .select({
        comment: attemptFeedback.comment,
        submittedAt: attemptFeedback.submittedAt,
      })
      .from(attemptFeedback)
      .where(eq(attemptFeedback.attemptId, id))
      .get();
    return NextResponse.json({ submitted: Boolean(feedback), feedback: feedback ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load feedback.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    await requireFeedbackSubmitter(id, user.id);
    const body = (await request.json()) as { comment?: unknown };
    const comment = String(body.comment ?? "").trim();
    if (comment.length > 10_000) {
      throw new Error("Feedback is limited to 10,000 characters.");
    }
    const submittedAt = new Date().toISOString();
    const inserted = await db
      .insert(attemptFeedback)
      .values({ attemptId: id, submitterUserId: user.id, comment, submittedAt })
      .onConflictDoNothing()
      .run();
    if (inserted.changes !== 1) {
      return NextResponse.json(
        { error: "Feedback has already been submitted and cannot be changed." },
        { status: 409 },
      );
    }
    return NextResponse.json({ submitted: true, feedback: { comment, submittedAt } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit feedback.";
    const existing =
      error instanceof Error &&
      /unique|constraint/i.test(error.message);
    return NextResponse.json({ error: message }, { status: existing ? 409 : 400 });
  }
}
