import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { questionSetLabel } from "@/lib/catalog";
import { attemptAnswers, attempts, questionSets } from "@/db/schema";
import {
  isWarmup,
  questionBlockName,
  questionTimeLimit,
  shuffled,
  toPublicQuestion,
  type AssessmentResult,
  type AttemptOutline,
  type AttemptOutlineItem,
  type AttemptView,
  type FillReview,
  type QuestionReview,
  type QuestionTiming,
  type StoredQuestion,
} from "@/lib/quiz";

export async function createAttempt(input: {
  questionSetId: string;
  randomize: boolean;
  countdownHidden: boolean;
}) {
  const set = await db
    .select()
    .from(questionSets)
    .where(eq(questionSets.id, input.questionSetId))
    .get();
  if (!set) throw new Error("Question set not found.");

  const questions = JSON.parse(set.questionsJson) as StoredQuestion[];
  // Warm-ups lead the attempt in card order and are never shuffled into the sequence, so
  // every participant meets the same orientation items first and their latencies stay
  // comparable. Randomization applies to the scored questions only.
  const warmupOrder = questions.filter(isWarmup).map((question) => question.id);
  const scoredOrder = questions
    .filter((question) => !isWarmup(question))
    .map((question) => question.id);
  const order = [
    ...warmupOrder,
    ...(input.randomize ? shuffled(scoredOrder) : scoredOrder),
  ];
  const id = randomUUID();

  await db.insert(attempts).values({
    id,
    questionSetId: input.questionSetId,
    randomize: input.randomize,
    countdownHidden: input.countdownHidden,
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

  // The first serve stamps the clock start and snapshots the soft limit in force at that
  // moment, so later edits to a question set cannot retroactively change recorded timings.
  await db
    .insert(attemptAnswers)
    .values({
      id: randomUUID(),
      attemptId,
      questionId,
      questionType: question.type,
      blockName: questionBlockName(question),
      startedAt: new Date().toISOString(),
      timeLimitSeconds: questionTimeLimit(question),
    })
    .onConflictDoNothing()
    .run();

  const answerRow = await getCurrentAnswer(attemptId, questionId);

  return {
    attempt: {
      attemptId,
      questionSetId: set.id,
      paperName: set.paperName,
      modelId: set.modelId,
      currentIndex: attempt.currentIndex,
      totalQuestions: order.length,
      question: toPublicQuestion(question),
      countdownHidden: attempt.countdownHidden,
      elapsedMs: answerRow
        ? Math.max(0, Date.now() - new Date(answerRow.startedAt).getTime())
        : 0,
      firstInteractionRecorded: Boolean(answerRow?.firstInteractionAt),
    },
  };
}

/** Attempt plus its question set, without requiring a servable current question. */
async function loadAttemptContextLoose(attemptId: string) {
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
  return { attempt, set, questions, order, questionById };
}

export async function loadAttemptContext(attemptId: string) {
  const context = await loadAttemptContextLoose(attemptId);
  const currentQuestion = context.questionById.get(
    context.order[context.attempt.currentIndex],
  );
  if (!currentQuestion) throw new Error("The attempt references a missing question.");
  return { ...context, currentQuestion };
}

/**
 * Builds the researcher-facing plan of an attempt: what each question is, in what order,
 * and which are already answered. Includes card names and generated descriptions, so this
 * must not be surfaced to the person taking the assessment.
 */
export async function getAttemptOutline(attemptId: string): Promise<AttemptOutline> {
  const quiz = await loadAttemptContextLoose(attemptId);
  const answers = await db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));
  const answeredIds = new Set(
    answers.filter((answer) => answer.submittedAt).map((answer) => answer.questionId),
  );

  const items = quiz.order.map((questionId, index): AttemptOutlineItem => {
    const question = quiz.questionById.get(questionId);
    if (!question) throw new Error("The attempt references a missing question.");
    return {
      position: index + 1,
      questionId,
      type: question.type,
      blockName: questionBlockName(question),
      description: question.description?.trim() ?? "",
      timeLimitSeconds: questionTimeLimit(question),
      warmup: isWarmup(question),
      answered: answeredIds.has(questionId),
    };
  });

  const answeredCount = items.filter((item) => item.answered).length;
  const graded = quiz.attempt.status === "graded" && Boolean(quiz.attempt.gradingJson);
  return {
    attemptId,
    questionSetId: quiz.set.id,
    setLabel: questionSetLabel(quiz.set.name, quiz.set.paperName),
    paperName: quiz.set.paperName,
    modelId: quiz.set.modelId,
    status: quiz.attempt.status,
    totalQuestions: items.length,
    answeredCount,
    scoredQuestionCount: items.filter((item) => !item.warmup).length,
    graded,
    gradable: !graded && answeredCount === items.length && items.length > 0,
    participantBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    items,
  };
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

  const reviews = input.order.map((questionId): QuestionReview => {
    const question = questionById.get(questionId);
    const answer = answerByQuestion.get(questionId);
    if (!question || !answer || answer.score === null) {
      throw new Error("Attempt grading is incomplete.");
    }
    const timing: QuestionTiming & { warmup: boolean } = {
      durationMs: answer.durationMs ?? 0,
      firstInteractionMs: answer.firstInteractionMs ?? null,
      timeLimitSeconds: answer.timeLimitSeconds ?? null,
      overrunMs: answer.overrunMs ?? null,
      warmup: isWarmup(question),
    };
    if (question.type === "fill_blank") {
      const feedback = JSON.parse(answer.feedbackJson ?? "{}") as {
        blanks?: FillReview["blanks"];
      };
      return {
        ...timing,
        type: "fill_blank",
        questionId,
        segments: question.segments,
        score: answer.score,
        blanks: feedback.blanks ?? [],
      };
    }
    if (question.type === "multiple_choice") {
      const selectedOptionId =
        (JSON.parse(answer.answerJson ?? "{}") as { optionId?: string }).optionId ?? null;
      return {
        ...timing,
        type: "multiple_choice",
        questionId,
        prompt: question.prompt,
        options: question.options,
        selectedOptionId,
        correctOptionId: question.correctOptionId,
        correct: selectedOptionId === question.correctOptionId,
        rationale: question.rationale,
        score: answer.score,
      };
    }
    return {
      ...timing,
      type: "free_response",
      questionId,
      prompt: question.prompt,
      response: (JSON.parse(answer.answerJson ?? "{}") as { response?: string }).response ?? "",
      rubric: question.rubric,
      score: answer.score,
      feedback:
        (JSON.parse(answer.feedbackJson ?? "{}") as { feedback?: string }).feedback ?? "",
    };
  });

  // Warm-ups are graded and reviewed but contribute nothing to the headline number, so a
  // near-certain 100 cannot inflate the score or compress the between-condition gap.
  const scoredReviews = reviews.filter((review) => !review.warmup);
  const overallScore =
    scoredReviews.reduce((sum, review) => sum + review.score, 0) /
    Math.max(scoredReviews.length, 1);
  return {
    attemptId: input.attemptId,
    questionSetId: input.questionSetId,
    paperName: input.paperName,
    overallScore: scoredReviews.length ? Math.round(overallScore * 10) / 10 : 0,
    scoredQuestionCount: scoredReviews.length,
    warmupQuestionCount: reviews.length - scoredReviews.length,
    questions: reviews,
  };
}
