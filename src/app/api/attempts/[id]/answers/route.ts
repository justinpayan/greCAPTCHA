import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attemptAnswers } from "@/db/schema";
import { AttemptClosedError, requireOpenAttempt } from "@/lib/attempt-access";
import { getCurrentAnswer, loadAttemptContext } from "@/lib/attempts";
import { draftSubmissionSchema } from "@/lib/quiz";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const submission = draftSubmissionSchema.parse(await request.json());
    await requireOpenAttempt(id);
    const quiz = await loadAttemptContext(id);
    if (quiz.attempt.status !== "active") {
      return NextResponse.json({ error: "This attempt is already complete." }, { status: 409 });
    }

    const position = quiz.order.indexOf(submission.questionId);
    const question = quiz.questionById.get(submission.questionId);
    if (position < 0 || !question) throw new Error("Question not found in this attempt.");
    if (submission.answer.type !== question.type) {
      throw new Error("The draft answer type does not match the question.");
    }
    if (
      question.type === "multiple_choice" &&
      submission.answer.type === "multiple_choice" &&
      submission.answer.optionId !== null &&
      !question.options.some((option) => option.id === submission.answer.optionId)
    ) {
      throw new Error("The selected option does not belong to this question.");
    }
    const answerRow = await getCurrentAnswer(id, submission.questionId);
    if (!answerRow) throw new Error("Visit the question before saving an answer.");
    await db
      .update(attemptAnswers)
      .set({ answerJson: JSON.stringify(submission.answer) })
      .where(eq(attemptAnswers.id, answerRow.id))
      .run();
    return NextResponse.json({ saved: true, position: position + 1 });
  } catch (error) {
    if (error instanceof AttemptClosedError) {
      return NextResponse.json(
        { error: error.message, locked: true, paused: error.paused },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to save answer.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
