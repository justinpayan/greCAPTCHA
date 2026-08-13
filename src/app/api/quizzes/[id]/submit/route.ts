import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { quizzes } from "@/db/schema";
import { submissionSchema, type StoredQuestion } from "@/lib/quiz";

export const runtime = "nodejs";

function normalizeAnswer(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const submission = submissionSchema.parse(await request.json());
    const quiz = await db.select().from(quizzes).where(eq(quizzes.id, id)).get();

    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
    }
    if (quiz.status !== "active") {
      return NextResponse.json(
        { error: "This quiz has already been submitted." },
        { status: 409 },
      );
    }

    const questions = JSON.parse(quiz.questionsJson) as StoredQuestion[];
    let correct = 0;
    let total = 0;

    const feedback = questions.map((question, index) => {
      const blanks = question.blanks.map((blank) => {
        total += 1;
        const key = `${question.id}:${blank.id}`;
        const selectedChoiceId = submission.answers[key] ?? null;
        const selectedChoice = question.choices.find(
          (choice) => choice.id === selectedChoiceId,
        );
        const selectedAnswer = selectedChoice?.label ?? null;
        const isCorrect =
          selectedAnswer !== null &&
          normalizeAnswer(selectedAnswer) === normalizeAnswer(blank.answer);
        if (isCorrect) correct += 1;
        return {
          blankId: blank.id,
          selectedAnswer,
          correctAnswer: blank.answer,
          correct: isCorrect,
        };
      });
      return {
        questionNumber: index + 1,
        correct: blanks.every((blank) => blank.correct),
        blanks,
      };
    });

    const score = total === 0 ? 0 : correct / total;
    const passed = score >= 0.8;
    const submittedAt = new Date().toISOString();

    await db
      .update(quizzes)
      .set({
        answersJson: JSON.stringify(submission.answers),
        score,
        passed,
        status: "graded",
        submittedAt,
      })
      .where(eq(quizzes.id, id));

    return NextResponse.json({
      result: {
        score,
        percentage: Math.round(score * 100),
        passed,
        correct,
        total,
        threshold: 80,
        feedback,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to grade this quiz.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
