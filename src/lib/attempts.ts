import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts, questionSets } from "@/db/schema";
import {
  shuffled,
  toPublicQuestion,
  type AssessmentResult,
  type AttemptView,
  type FillReview,
  type FreeResponseReview,
  type StoredQuestion,
} from "@/lib/quiz";

export async function createAttempt(questionSetId: string, randomize: boolean) {
  const set = await db
    .select()
    .from(questionSets)
    .where(eq(questionSets.id, questionSetId))
    .get();
  if (!set) throw new Error("Question set not found.");

  const questions = JSON.parse(set.questionsJson) as StoredQuestion[];
  const canonicalOrder = questions.map((question) => question.id);
  const order = randomize ? shuffled(canonicalOrder) : canonicalOrder;
  const id = randomUUID();

  await db.insert(attempts).values({
    id,
    questionSetId,
    randomize,
    questionOrderJson: JSON.stringify(order),
    currentIndex: 0,
    status: "active",
    createdAt: new Date().toISOString(),
  });
  return getAttemptState(id);
}

export async function getAttemptState(
  attemptId: string,
): Promise<{ attempt?: AttemptView; result?: AssessmentResult }> {
  const attempt = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt) throw new Error("Attempt not found.");

  if (attempt.status === "graded" && attempt.gradingJson) {
    return { result: JSON.parse(attempt.gradingJson) as AssessmentResult };
  }

  const set = await db
    .select()
    .from(questionSets)
    .where(eq(questionSets.id, attempt.questionSetId))
    .get();
  if (!set) throw new Error("Question set not found.");

  const questions = JSON.parse(set.questionsJson) as StoredQuestion[];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const order = JSON.parse(attempt.questionOrderJson) as string[];
  const questionId = order[attempt.currentIndex];
  const question = questionById.get(questionId);
  if (!question) throw new Error("The attempt references a missing question.");

  await db
    .insert(attemptAnswers)
    .values({
      id: randomUUID(),
      attemptId,
      questionId,
      questionType: question.type,
      startedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();

  return {
    attempt: {
      attemptId,
      questionSetId: set.id,
      paperName: set.paperName,
      modelId: set.modelId,
      currentIndex: attempt.currentIndex,
      totalQuestions: order.length,
      question: toPublicQuestion(question),
    },
  };
}

export async function loadAttemptContext(attemptId: string) {
  const attempt = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt) throw new Error("Attempt not found.");
  const set = await db
    .select()
    .from(questionSets)
    .where(eq(questionSets.id, attempt.questionSetId))
    .get();
  if (!set) throw new Error("Question set not found.");
  const questions = JSON.parse(set.questionsJson) as StoredQuestion[];
  const order = JSON.parse(attempt.questionOrderJson) as string[];
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const currentQuestion = questionById.get(order[attempt.currentIndex]);
  if (!currentQuestion) throw new Error("The attempt references a missing question.");
  return { attempt, set, questions, order, questionById, currentQuestion };
}

export async function getCurrentAnswer(attemptId: string, questionId: string) {
  return db
    .select()
    .from(attemptAnswers)
    .where(
      and(
        eq(attemptAnswers.attemptId, attemptId),
        eq(attemptAnswers.questionId, questionId),
      ),
    )
    .get();
}

export function buildResult(input: {
  attemptId: string;
  questionSetId: string;
  paperName: string;
  order: string[];
  questions: StoredQuestion[];
  answers: Array<typeof attemptAnswers.$inferSelect>;
}): AssessmentResult {
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  const answerByQuestion = new Map(input.answers.map((answer) => [answer.questionId, answer]));

  const reviews = input.order.map((questionId): FillReview | FreeResponseReview => {
    const question = questionById.get(questionId);
    const answer = answerByQuestion.get(questionId);
    if (!question || !answer || answer.score === null) {
      throw new Error("Attempt grading is incomplete.");
    }
    if (question.type === "fill_blank") {
      const feedback = JSON.parse(answer.feedbackJson ?? "{}") as {
        blanks?: FillReview["blanks"];
      };
      return {
        type: "fill_blank",
        questionId,
        segments: question.segments,
        score: answer.score,
        durationMs: answer.durationMs ?? 0,
        blanks: feedback.blanks ?? [],
      };
    }
    return {
      type: "free_response",
      questionId,
      prompt: question.prompt,
      response: (JSON.parse(answer.answerJson ?? "{}") as { response?: string }).response ?? "",
      rubric: question.rubric,
      score: answer.score,
      feedback:
        (JSON.parse(answer.feedbackJson ?? "{}") as { feedback?: string }).feedback ?? "",
      durationMs: answer.durationMs ?? 0,
    };
  });

  const overallScore =
    reviews.reduce((sum, review) => sum + review.score, 0) / Math.max(reviews.length, 1);
  return {
    attemptId: input.attemptId,
    questionSetId: input.questionSetId,
    paperName: input.paperName,
    overallScore: Math.round(overallScore * 10) / 10,
    questions: reviews,
  };
}
