import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  attemptAnswers,
  attemptFeedback,
  attemptQuestionFeedback,
  attempts,
} from "@/db/schema";
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
    const submission = await db
      .select({
        submittedAt: attemptFeedback.submittedAt,
      })
      .from(attemptFeedback)
      .where(eq(attemptFeedback.attemptId, id))
      .get();
    if (!submission) {
      return NextResponse.json({ submitted: false, feedback: null });
    }
    const comments = await db
      .select({
        questionId: attemptQuestionFeedback.questionId,
        comment: attemptQuestionFeedback.comment,
      })
      .from(attemptQuestionFeedback)
      .where(eq(attemptQuestionFeedback.attemptId, id));
    return NextResponse.json({
      submitted: true,
      feedback: {
        commentsByQuestionId: Object.fromEntries(
          comments.map((row) => [row.questionId, row.comment]),
        ),
        submittedAt: submission.submittedAt,
      },
    });
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
    const existingFeedback = await db
      .select({ attemptId: attemptFeedback.attemptId })
      .from(attemptFeedback)
      .where(eq(attemptFeedback.attemptId, id))
      .get();
    if (existingFeedback) {
      return NextResponse.json(
        { error: "Feedback has already been submitted and cannot be changed." },
        { status: 409 },
      );
    }
    const body = (await request.json()) as { commentsByQuestionId?: unknown };
    const rawComments = body.commentsByQuestionId;
    if (
      !rawComments ||
      typeof rawComments !== "object" ||
      Array.isArray(rawComments)
    ) {
      throw new Error("Feedback must be provided by question.");
    }
    const comments = Object.entries(rawComments as Record<string, unknown>).map(
      ([questionId, value]) => {
        if (typeof value !== "string") {
          throw new Error("Every question comment must be text.");
        }
        return { questionId, comment: value.trim() };
      },
    );
    if (comments.reduce((total, item) => total + item.comment.length, 0) > 10_000) {
      throw new Error("Feedback is limited to 10,000 characters in total.");
    }
    const answers = await db
      .select({ questionId: attemptAnswers.questionId })
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, id));
    const validQuestionIds = new Set(answers.map((answer) => answer.questionId));
    const unknown = comments.find((item) => !validQuestionIds.has(item.questionId));
    if (unknown) {
      throw new Error("Feedback references a question outside this attempt.");
    }

    const submittedAt = new Date().toISOString();
    let inserted = false;
    db.transaction((tx) => {
      const result = tx
        .insert(attemptFeedback)
        .values({ attemptId: id, submitterUserId: user.id, submittedAt })
        .onConflictDoNothing()
        .run();
      inserted = result.changes === 1;
      const nonEmpty = comments.filter((item) => item.comment);
      if (inserted && nonEmpty.length > 0) {
        tx.insert(attemptQuestionFeedback)
          .values(nonEmpty.map((item) => ({ attemptId: id, ...item })))
          .run();
      }
    });
    if (!inserted) {
      return NextResponse.json(
        { error: "Feedback has already been submitted and cannot be changed." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      submitted: true,
      feedback: {
        commentsByQuestionId: Object.fromEntries(
          comments
            .filter((item) => item.comment)
            .map((item) => [item.questionId, item.comment]),
        ),
        submittedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit feedback.";
    const existing =
      error instanceof Error &&
      /unique|constraint/i.test(error.message);
    return NextResponse.json({ error: message }, { status: existing ? 409 : 400 });
  }
}
