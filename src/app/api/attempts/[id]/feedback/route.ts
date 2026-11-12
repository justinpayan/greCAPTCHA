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
import { currentUser } from "@/lib/session";
import { proctoredAttempt, verifiedSebSession } from "@/lib/seb";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

async function requireFeedbackSubmitter(attemptId: string, request: Request, writing = false) {
  await requireOpenAttempt(attemptId);
  const seb = await verifiedSebSession(attemptId, request);
  if (writing && proctoredAttempt(attemptId) && !seb) {
    throw new Error("Submit feedback inside Safe Exam Browser.");
  }
  const userId = seb?.takerUserId ?? (await currentUser())?.id;
  const attempt = await db
    .select({
      status: attempts.status,
      takerUserId: attempts.takerUserId,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .get();
  if (!userId || !attempt || attempt.takerUserId !== userId) {
    throw new Error("Only the examinee can submit feedback.");
  }
  if (attempt.status !== "graded") {
    throw new Error("Feedback opens after grading is complete.");
  }
  return userId;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireFeedbackSubmitter(id, request);
    const canSubmit = !proctoredAttempt(id) || Boolean(await verifiedSebSession(id, request));
    const submission = await db
      .select({
        submittedAt: attemptFeedback.submittedAt,
        generalComment: attemptFeedback.generalComment,
      })
      .from(attemptFeedback)
      .where(eq(attemptFeedback.attemptId, id))
      .get();
    if (!submission) {
      return NextResponse.json({ submitted: false, feedback: null, canSubmit });
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
      canSubmit,
      feedback: {
        commentsByQuestionId: Object.fromEntries(
          comments.map((row) => [row.questionId, row.comment]),
        ),
        submittedAt: submission.submittedAt,
        generalComment: submission.generalComment,
      },
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to load feedback.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const userId = await requireFeedbackSubmitter(id, request, true);
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
    const body = (await request.json()) as { commentsByQuestionId?: unknown; generalComment?: unknown };
    const generalComment = proctoredAttempt(id) && typeof body.generalComment === "string"
      ? body.generalComment.trim() : "";
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
    if (comments.reduce((total, item) => total + item.comment.length, generalComment.length) > 10_000) {
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
        .values({ attemptId: id, submitterUserId: userId, submittedAt, generalComment: generalComment || null })
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
    const message = publicErrorMessage(error, "Unable to submit feedback.");
    const existing =
      error instanceof Error &&
      /unique|constraint/i.test(error.message);
    return NextResponse.json({ error: message }, { status: existing ? 409 : 400 });
  }
}
