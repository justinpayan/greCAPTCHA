import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { questionSetLabel } from "@/lib/catalog";
import {
  attemptAnswers,
  attemptFeedback,
  attempts,
  questionSets,
  users,
} from "@/db/schema";
import {
  isWarmup,
  draftHasAnswer,
  parseDraft,
  questionBlockName,
  questionTimeLimit,
  shuffled,
  toPublicQuestion,
  type AssessmentResult,
  type AttemptIntro,
  type AttemptOutline,
  type AttemptOutlineItem,
  type AttemptView,
  type FillReview,
  type QuestionReview,
  type QuestionTiming,
  type StoredQuestion,
} from "@/lib/quiz";

/**
 * Creates an attempt without serving anything.
 *
 * Returns only the ID on purpose. Serving the first question here would stamp its
 * `startedAt`, and since attempts are created ahead of a session — sometimes days ahead —
 * that clock would run for the whole waiting period and record a duration measured in days
 * for question one. The first question is stamped when it is actually served instead.
 *
 * The link starts closed, so an ID that reaches a participant early cannot be used.
 * Reusable assessment links create an open attempt already assigned to the signed-in taker.
 */
export async function createAttempt(input: {
  questionSetId: string;
  ownerUserId?: string;
  randomize: boolean;
  countdownHidden: boolean;
  taker?: { id: string; username: string };
}): Promise<{ attemptId: string }> {
  if (input.ownerUserId) {
    const limit = Math.max(1, Number(process.env.MAX_ATTEMPTS_PER_ACCOUNT ?? "500"));
    const existing = await db
      .select({ total: count() })
      .from(attempts)
      .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
      .where(eq(questionSets.ownerUserId, input.ownerUserId))
      .get();
    if ((existing?.total ?? 0) >= limit) {
      throw new Error(`Your account has reached its limit of ${limit} attempts.`);
    }
  }
  const set = await db
    .select()
    .from(questionSets)
    .where(
      input.ownerUserId
        ? and(
            eq(questionSets.id, input.questionSetId),
            eq(questionSets.ownerUserId, input.ownerUserId),
          )
        : eq(questionSets.id, input.questionSetId),
    )
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
    overallTimeLimitSeconds: set.overallTimeLimitSeconds,
    randomize: input.randomize,
    countdownHidden: input.countdownHidden,
    linkEnabled: Boolean(input.taker),
    takerUserId: input.taker?.id ?? null,
    takerUsername: input.taker?.username ?? null,
    questionOrderJson: JSON.stringify(order),
    currentIndex: 0,
    status: "active",
    createdAt: new Date().toISOString(),
  });
  return { attemptId: id };
}

/** Creates or returns the reusable capability URL for an owned question set. */
export async function createQuestionSetShareLink(questionSetId: string, ownerUserId: string) {
  const set = await db
    .select({ shareToken: questionSets.shareToken })
    .from(questionSets)
    .where(
      and(
        eq(questionSets.id, questionSetId),
        eq(questionSets.ownerUserId, ownerUserId),
      ),
    )
    .get();
  if (!set) throw new Error("Question set not found.");
  const shareToken = set.shareToken ?? randomUUID();
  if (!set.shareToken) {
    await db
      .update(questionSets)
      .set({ shareToken })
      .where(and(eq(questionSets.id, questionSetId), isNull(questionSets.shareToken)))
      .run();
    const winner = await db
      .select({ shareToken: questionSets.shareToken })
      .from(questionSets)
      .where(eq(questionSets.id, questionSetId))
      .get();
    if (!winner?.shareToken) throw new Error("Unable to create the assessment link.");
    return { participantPath: `/take/${winner.shareToken}` };
  }
  return { participantPath: `/take/${shareToken}` };
}

const takerAttemptCreations = new Map<string, Promise<{ attemptId: string }>>();

/** Gives each signed-in account one independent attempt reached through a reusable set link. */
export function getOrCreateTakerAttempt(
  shareToken: string,
  taker: { id: string; username: string },
) {
  const key = `${shareToken}\0${taker.id}`;
  const active = takerAttemptCreations.get(key);
  if (active) return active;
  const creation = createTakerAttemptIfNeeded(shareToken, taker).finally(() => {
    takerAttemptCreations.delete(key);
  });
  takerAttemptCreations.set(key, creation);
  return creation;
}

async function createTakerAttemptIfNeeded(
  shareToken: string,
  taker: { id: string; username: string },
) {
  const set = await db
    .select()
    .from(questionSets)
    .where(eq(questionSets.shareToken, shareToken))
    .get();
  if (!set) throw new Error("Assessment link not found.");
  const existing = await db
    .select({ attemptId: attempts.id })
    .from(attempts)
    .where(
      and(
        eq(attempts.questionSetId, set.id),
        eq(attempts.takerUserId, taker.id),
      ),
    )
    .orderBy(desc(attempts.createdAt))
    .get();
  if (existing) return existing;

  const previous = await db
    .select({
      randomize: attempts.randomize,
      countdownHidden: attempts.countdownHidden,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .where(
      and(
        eq(attempts.questionSetId, set.id),
        eq(questionSets.ownerUserId, set.ownerUserId),
      ),
    )
    .orderBy(desc(attempts.createdAt))
    .get();

  return createAttempt({
    questionSetId: set.id,
    ownerUserId: set.ownerUserId,
    randomize: previous?.randomize ?? false,
    countdownHidden: previous?.countdownHidden ?? false,
    taker,
  });
}

export async function requireAttemptOwner(attemptId: string, ownerUserId: string) {
  const row = await db
    .select({
      id: attempts.id,
      status: attempts.status,
      takerUserId: attempts.takerUserId,
      ownerUsername: users.username,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .innerJoin(users, eq(users.id, questionSets.ownerUserId))
    .where(and(eq(attempts.id, attemptId), eq(questionSets.ownerUserId, ownerUserId)))
    .get();
  if (!row) throw new Error("Attempt not found.");
  // Attempts completed by their owner before taker tracking was introduced have no recorded
  // taker. Opening their researcher summary is enough to backfill the only identifiable account.
  if (row.status === "graded" && !row.takerUserId) {
    await db
      .update(attempts)
      .set({ takerUserId: ownerUserId, takerUsername: row.ownerUsername })
      .where(and(eq(attempts.id, attemptId), isNull(attempts.takerUserId)))
      .run();
  }
}

/**
 * Time spent against an attempt's overall budget.
 *
 * A sum of per-question durations rather than wall-clock from the first question: a session that
 * was paused by disabling its link, a reload, or a closed laptop then costs nothing. The question
 * currently open contributes the time it has been open so far, so the figure ticks live.
 */
export function attemptElapsedMs(
  answers: Array<{ durationMs: number | null }>,
  activeQuestionStartedAt: string | null,
): number {
  const recorded = answers.reduce((total, answer) => total + (answer.durationMs ?? 0), 0);
  return (
    recorded +
    (activeQuestionStartedAt
      ? Math.max(0, Date.now() - new Date(activeQuestionStartedAt).getTime())
      : 0)
  );
}

export async function getAttemptState(
  attemptId: string,
): Promise<{ attempt?: AttemptView; result?: AssessmentResult; pendingEvaluation?: boolean }> {
  const attempt = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt) throw new Error("Attempt not found.");

  if (attempt.status === "graded" && attempt.gradingJson) {
    const result = JSON.parse(attempt.gradingJson) as AssessmentResult;
    return {
      result: {
        ...result,
        takerUsername: result.takerUsername ?? attempt.takerUsername,
      },
    };
  }
  if (attempt.status === "submitted") return { pendingEvaluation: true };

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

  const servedAt = new Date().toISOString();
  // The first serve stamps the question's first visit and snapshots its configured limit.
  await db
    .insert(attemptAnswers)
    .values({
      id: randomUUID(),
      attemptId,
      questionId,
      questionType: question.type,
      blockName: questionBlockName(question),
      startedAt: servedAt,
      timeLimitSeconds: questionTimeLimit(question),
    })
    .onConflictDoNothing()
    .run();

  const activeQuestionStartedAt = attempt.activeQuestionStartedAt ?? servedAt;
  if (!attempt.activeQuestionStartedAt) {
    await db
      .update(attempts)
      .set({ activeQuestionStartedAt })
      .where(eq(attempts.id, attemptId))
      .run();
  }

  const answerRow = await getCurrentAnswer(attemptId, questionId);
  const allAnswers = await db
    .select({
      durationMs: attemptAnswers.durationMs,
      questionId: attemptAnswers.questionId,
      answerJson: attemptAnswers.answerJson,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));

  const answerByQuestion = new Map(allAnswers.map((answer) => [answer.questionId, answer]));
  const draft = parseDraft(question, answerRow?.answerJson ?? null);
  const activeElapsedMs = Math.max(
    0,
    Date.now() - new Date(activeQuestionStartedAt).getTime(),
  );

  return {
    attempt: {
      attemptId,
      questionSetId: set.id,
      paperName: set.paperName,
      currentIndex: attempt.currentIndex,
      totalQuestions: order.length,
      question: toPublicQuestion(question),
      draft,
      questionProgress: order.map((orderedQuestionId, index) => {
        const orderedQuestion = questionById.get(orderedQuestionId);
        const saved = answerByQuestion.get(orderedQuestionId);
        return {
          position: index + 1,
          answered: Boolean(
            orderedQuestion &&
              draftHasAnswer(parseDraft(orderedQuestion, saved?.answerJson ?? null)),
          ),
        };
      }),
      countdownHidden: attempt.countdownHidden,
      elapsedMs: (answerRow?.durationMs ?? 0) + activeElapsedMs,
      firstInteractionRecorded: Boolean(answerRow?.firstInteractionAt),
      overallTimeLimitSeconds: attempt.overallTimeLimitSeconds,
      overallElapsedMs: attemptElapsedMs(allAnswers, activeQuestionStartedAt),
    },
  };
}

/** Pause the current question and serve another question from the fixed attempt order. */
export async function navigateAttempt(attemptId: string, targetIndex: number) {
  const quiz = await loadAttemptContext(attemptId);
  if (quiz.attempt.status !== "active") throw new Error("This attempt is already complete.");
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= quiz.order.length) {
    throw new Error("Question position is out of range.");
  }
  if (targetIndex === quiz.attempt.currentIndex) return getAttemptState(attemptId);

  const now = new Date();
  const current = await getCurrentAnswer(attemptId, quiz.currentQuestion.id);
  if (current && quiz.attempt.activeQuestionStartedAt) {
    const visitMs = Math.max(
      0,
      now.getTime() - new Date(quiz.attempt.activeQuestionStartedAt).getTime(),
    );
    await db
      .update(attemptAnswers)
      .set({ durationMs: (current.durationMs ?? 0) + visitMs })
      .where(eq(attemptAnswers.id, current.id))
      .run();
  }
  await db
    .update(attempts)
    .set({
      currentIndex: targetIndex,
      activeQuestionStartedAt: now.toISOString(),
    })
    .where(eq(attempts.id, attemptId))
    .run();
  return getAttemptState(attemptId);
}

/**
 * Facts for the landing page that precedes a question set.
 *
 * Reads only. Unlike `getAttemptState` it serves nothing and stamps no `startedAt`, so a
 * participant can sit on the landing page for as long as they like without the first question's
 * clock running.
 */
export async function getAttemptIntro(attemptId: string): Promise<AttemptIntro> {
  const quiz = await loadAttemptContextLoose(attemptId);
  const served = await db
    .select({
      startedAt: attemptAnswers.startedAt,
      submittedAt: attemptAnswers.submittedAt,
      durationMs: attemptAnswers.durationMs,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));

  const inOrder = quiz.order
    .map((questionId) => quiz.questionById.get(questionId))
    .filter((question): question is StoredQuestion => Boolean(question));

  return {
    attemptId,
    totalQuestions: quiz.order.length,
    timedQuestionCount: inOrder.filter((question) => questionTimeLimit(question) !== null).length,
    overallTimeLimitSeconds: quiz.attempt.overallTimeLimitSeconds,
    started: served.length > 0,
    status: quiz.attempt.status,
    countdownHidden: quiz.attempt.countdownHidden,
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
  const feedback = await db
    .select({
      comment: attemptFeedback.comment,
      submittedAt: attemptFeedback.submittedAt,
    })
    .from(attemptFeedback)
    .where(eq(attemptFeedback.attemptId, attemptId))
    .get();
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
    takerUsername: quiz.attempt.takerUsername,
    setLabel: questionSetLabel(quiz.set.name, quiz.set.paperName),
    paperName: quiz.set.paperName,
    modelId: quiz.set.modelId,
    workflowType: quiz.set.workflowType === "conference" ? "conference" : "course",
    status: quiz.attempt.status,
    linkEnabled: quiz.attempt.linkEnabled,
    totalQuestions: items.length,
    answeredCount,
    scoredQuestionCount: items.filter((item) => !item.warmup).length,
    graded,
    gradable: !graded && answeredCount === items.length && items.length > 0,
    participantBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    examineeFeedback: feedback ?? null,
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
  takerUsername: string | null;
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
    const timing: QuestionTiming & {
      warmup: boolean;
      skipped: boolean;
      timedOut: boolean;
    } = {
      durationMs: answer.durationMs ?? 0,
      firstInteractionMs: answer.firstInteractionMs ?? null,
      timeLimitSeconds: answer.timeLimitSeconds ?? null,
      overrunMs: answer.overrunMs ?? null,
      warmup: isWarmup(question),
      skipped: answer.skipped,
      timedOut: answer.timedOut,
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
  // near-certain 100 cannot inflate the score.
  const scoredReviews = reviews.filter((review) => !review.warmup);
  const overallScore =
    scoredReviews.reduce((sum, review) => sum + review.score, 0) /
    Math.max(scoredReviews.length, 1);
  return {
    attemptId: input.attemptId,
    questionSetId: input.questionSetId,
    takerUsername: input.takerUsername,
    paperName: input.paperName,
    overallScore: scoredReviews.length ? Math.round(overallScore * 10) / 10 : 0,
    scoredQuestionCount: scoredReviews.length,
    warmupQuestionCount: reviews.length - scoredReviews.length,
    questions: reviews,
  };
}
