import "server-only";

import { and, count, desc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts, experiments, jobs, questionSets } from "@/db/schema";
import {
  isWarmup,
  questionBlockName,
  questionTimeLimit,
  type AttemptCondition,
  type AttemptListEntry,
  type QuestionSetListEntry,
  type QuestionSetOverview,
  type StoredQuestion,
} from "@/lib/quiz";

const LIST_LIMIT = 200;

/** A set always has something readable to show, even when it was never named. */
export function questionSetLabel(name: string | null, paperName: string) {
  return name?.trim() || paperName;
}

export async function listQuestionSets(ownerUserId: string): Promise<QuestionSetListEntry[]> {
  const sets = await db
    .select()
    .from(questionSets)
    .where(eq(questionSets.ownerUserId, ownerUserId))
    .orderBy(desc(questionSets.createdAt))
    .limit(LIST_LIMIT);

  const attemptCounts = await db
    .select({ questionSetId: attempts.questionSetId, total: count() })
    .from(attempts)
    .groupBy(attempts.questionSetId);
  const countBySet = new Map(attemptCounts.map((row) => [row.questionSetId, row.total]));

  // A set can be either paper of an experiment, so both columns count towards the total.
  const experimentUses = await db
    .select({
      own: experiments.ownQuestionSetId,
      foreign: experiments.foreignQuestionSetId,
    })
    .from(experiments);
  const experimentsBySet = new Map<string, number>();
  for (const use of experimentUses) {
    // Either paper may be unassigned, and an experiment counts once per set it actually uses.
    const used = new Set([use.own, use.foreign].filter((id): id is string => Boolean(id)));
    for (const setId of used) {
      experimentsBySet.set(setId, (experimentsBySet.get(setId) ?? 0) + 1);
    }
  }

  return sets.map((set) => ({
    id: set.id,
    name: set.name?.trim() ?? "",
    label: questionSetLabel(set.name, set.paperName),
    paperName: set.paperName,
    modelId: set.modelId,
    questionCount: (JSON.parse(set.questionsJson) as StoredQuestion[]).length,
    attemptCount: countBySet.get(set.id) ?? 0,
    experimentCount: experimentsBySet.get(set.id) ?? 0,
    createdAt: set.createdAt,
  }));
}

/**
 * A saved set's contents, without creating an attempt to see them.
 *
 * The plan page can only show a set's items once an attempt exists, which made inspecting a bank
 * cost an attempt. Items come back in generation order — warm-ups only move to the front when an
 * attempt is built, so this is the set as stored rather than as it will be asked.
 */
export async function getQuestionSetOverview(id: string, ownerUserId: string): Promise<QuestionSetOverview> {
  const set = await db.select().from(questionSets).where(and(eq(questionSets.id, id), eq(questionSets.ownerUserId, ownerUserId))).get();
  if (!set) throw new Error("Question set not found.");

  const attemptTotal = await db
    .select({ total: count() })
    .from(attempts)
    .where(eq(attempts.questionSetId, id))
    .get();
  const experimentUses = await db
    .select({ total: count() })
    .from(experiments)
    .where(or(eq(experiments.ownQuestionSetId, id), eq(experiments.foreignQuestionSetId, id)))
    .get();

  const questions = JSON.parse(set.questionsJson) as StoredQuestion[];
  return {
    id: set.id,
    name: set.name?.trim() ?? "",
    label: questionSetLabel(set.name, set.paperName),
    paperName: set.paperName,
    modelId: set.modelId,
    pdfEngine: set.pdfEngine,
    overallTimeLimitSeconds: set.overallTimeLimitSeconds,
    attemptCount: attemptTotal?.total ?? 0,
    experimentCount: experimentUses?.total ?? 0,
    createdAt: set.createdAt,
    items: questions.map((question, index) => ({
      position: index + 1,
      questionId: question.id,
      type: question.type,
      blockName: questionBlockName(question),
      description: question.description?.trim() ?? "",
      timeLimitSeconds: questionTimeLimit(question),
      warmup: isWarmup(question),
      question,
    })),
  };
}

export async function renameQuestionSet(id: string, name: string, ownerUserId: string) {
  const trimmed = name.trim();
  if (trimmed.length > 120) throw new Error("Set names are limited to 120 characters.");
  const result = await db
    .update(questionSets)
    .set({ name: trimmed || null })
    .where(and(eq(questionSets.id, id), eq(questionSets.ownerUserId, ownerUserId)))
    .run();
  if (result.changes !== 1) throw new Error("Question set not found.");
  return trimmed;
}

/**
 * Changes a set's overall time limit after generation.
 *
 * Also applies it to attempts on the set that **have not started** — one prepared the night before
 * would otherwise keep the budget it was created with, and an edit made the morning of a session
 * would silently do nothing for the very attempts about to be run.
 *
 * An attempt already under way is never re-budgeted. That is the whole point of snapshotting the
 * limit onto the attempt: someone answering question four should not have their remaining time
 * change underneath them, in either direction.
 */
export async function setQuestionSetOverallLimit(
  id: string,
  seconds: number | null,
  ownerUserId: string,
): Promise<{ overallTimeLimitSeconds: number | null; attemptsUpdated: number }> {
  if (seconds !== null && (!Number.isInteger(seconds) || seconds < 30 || seconds > 21_600)) {
    throw new Error("An overall limit must be between 30 seconds and 6 hours.");
  }

  const updated = await db
    .update(questionSets)
    .set({ overallTimeLimitSeconds: seconds })
    .where(and(eq(questionSets.id, id), eq(questionSets.ownerUserId, ownerUserId)))
    .run();
  if (updated.changes !== 1) throw new Error("Question set not found.");

  const active = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(and(eq(attempts.questionSetId, id), eq(attempts.status, "active")));
  if (active.length === 0) return { overallTimeLimitSeconds: seconds, attemptsUpdated: 0 };

  const startedIds = new Set(
    (
      await db
        .select({ attemptId: attemptAnswers.attemptId })
        .from(attemptAnswers)
        .where(inArray(attemptAnswers.attemptId, active.map((row) => row.id)))
    ).map((row) => row.attemptId),
  );
  const unstarted = active.filter((row) => !startedIds.has(row.id)).map((row) => row.id);
  if (unstarted.length === 0) return { overallTimeLimitSeconds: seconds, attemptsUpdated: 0 };

  await db
    .update(attempts)
    .set({ overallTimeLimitSeconds: seconds })
    .where(inArray(attempts.id, unstarted))
    .run();
  return { overallTimeLimitSeconds: seconds, attemptsUpdated: unstarted.length };
}

/**
 * Deletes a set and, by foreign-key cascade, every attempt on it and every answer in those
 * attempts. `foreign_keys = ON` is set when the connection opens, so the cascade chains
 * from question_sets through attempts to attempt_answers.
 *
 * Refused while an experiment depends on the set. Deleting it would otherwise reach through
 * the experiment and take the *other* paper's attempt with it, which is far more destruction
 * than "delete this set" suggests.
 */
export async function deleteQuestionSet(id: string, ownerUserId: string) {
  const owned = await db.select({ id: questionSets.id }).from(questionSets)
    .where(and(eq(questionSets.id, id), eq(questionSets.ownerUserId, ownerUserId))).get();
  if (!owned) throw new Error("Question set not found.");
  const uses = await db
    .select({ participantId: experiments.participantId })
    .from(experiments)
    .where(or(eq(experiments.ownQuestionSetId, id), eq(experiments.foreignQuestionSetId, id)));
  if (uses.length > 0) {
    const named = uses.map((use) => use.participantId).join(", ");
    const plural = uses.length === 1;
    throw new Error(
      `This set is used by ${uses.length} experiment${plural ? "" : "s"} (participant${plural ? "" : "s"} ${named}). Delete ${plural ? "that experiment" : "those experiments"} first.`,
    );
  }
  const result = await db.delete(questionSets).where(and(eq(questionSets.id, id), eq(questionSets.ownerUserId, ownerUserId))).run();
  if (result.changes !== 1) throw new Error("Question set not found.");
}

/**
 * Opens or closes an attempt's participant link.
 *
 * Deliberately allowed on an attempt that is already under way: closing one halts it at the
 * next request, which is how a session that has run out of time is stopped.
 */
async function requireOwnedAttempt(id: string, ownerUserId: string) {
  const row = await db.select({ id: attempts.id }).from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .where(and(eq(attempts.id, id), eq(questionSets.ownerUserId, ownerUserId))).get();
  if (!row) throw new Error("Attempt not found.");
}

export async function setAttemptLinkEnabled(id: string, enabled: boolean, ownerUserId: string) {
  await requireOwnedAttempt(id, ownerUserId);
  const result = await db
    .update(attempts)
    .set({ linkEnabled: enabled })
    .where(eq(attempts.id, id))
    .run();
  if (result.changes !== 1) throw new Error("Attempt not found.");
  return enabled;
}

/**
 * Deletes one attempt and its answers, leaving the question set intact.
 *
 * Refused for an attempt that belongs to an experiment: half a pair cannot answer the
 * within-person comparison the experiment exists for, so the pair is deleted as a unit.
 */
export async function deleteAttempt(id: string, ownerUserId: string) {
  await requireOwnedAttempt(id, ownerUserId);
  const attempt = await db
    .select({ experimentId: attempts.experimentId })
    .from(attempts)
    .where(eq(attempts.id, id))
    .get();
  if (!attempt) throw new Error("Attempt not found.");
  if (attempt.experimentId) {
    throw new Error(
      "This attempt is one block of an experiment. Delete the experiment instead, which removes both blocks.",
    );
  }
  const result = await db.delete(attempts).where(eq(attempts.id, id)).run();
  if (result.changes !== 1) throw new Error("Attempt not found.");
}

/**
 * Wipes an attempt's progress and returns it to the state a freshly created attempt is in.
 *
 * Every answer row goes — responses, timings, first-interaction stamps, per-question scores and
 * grader feedback — along with the attempt's own grade. What survives is the attempt's identity:
 * the same ID, so a link already handed out still works, and the same question order, so a reset
 * is a clean re-run of the identical instrument rather than a new draw. That matters most inside
 * an experiment, where the other block has often already run against its own fixed order.
 *
 * A taker-assigned response remains available through the reusable set link after reset.
 *
 * The overall budget is re-read from the question set rather than kept, on the same reasoning
 * `createAttempt` uses — the snapshot exists to protect an attempt that is *under way* from an
 * edit to its set, and after a reset nothing is under way.
 *
 * Allowed on a graded attempt, deliberately: discarding a completed run under conditions the
 * researcher wants to throw away is the main reason this exists. The confirmation lives in the
 * interface, since the loss is not recoverable here.
 */
export async function resetAttempt(id: string, ownerUserId: string): Promise<{
  answersCleared: number;
  overallTimeLimitSeconds: number | null;
}> {
  await requireOwnedAttempt(id, ownerUserId);
  const attempt = await db
    .select({
      questionSetId: attempts.questionSetId,
      takerUserId: attempts.takerUserId,
    })
    .from(attempts)
    .where(eq(attempts.id, id))
    .get();
  if (!attempt) throw new Error("Attempt not found.");

  const set = await db
    .select({ overallTimeLimitSeconds: questionSets.overallTimeLimitSeconds })
    .from(questionSets)
    .where(eq(questionSets.id, attempt.questionSetId))
    .get();
  if (!set) throw new Error("Question set not found.");

  // Answers first. A half-finished reset then leaves an attempt whose grade still renders from
  // `grading_json`, rather than an active attempt sitting on a locked answer row it cannot pass.
  const cleared = await db
    .delete(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, id))
    .run();

  await db
    .update(attempts)
    .set({
      currentIndex: 0,
      status: "active",
      score: null,
      gradingJson: null,
      completedAt: null,
      linkEnabled: Boolean(attempt.takerUserId),
      overallTimeLimitSeconds: set.overallTimeLimitSeconds,
    })
    .where(eq(attempts.id, id))
    .run();

  return {
    answersCleared: cleared.changes,
    overallTimeLimitSeconds: set.overallTimeLimitSeconds,
  };
}

export async function listAttempts(ownerUserId: string): Promise<AttemptListEntry[]> {
  const rows = await db
    .select({
      id: attempts.id,
      questionSetId: attempts.questionSetId,
      status: attempts.status,
      score: attempts.score,
      randomize: attempts.randomize,
      linkEnabled: attempts.linkEnabled,
      questionOrderJson: attempts.questionOrderJson,
      createdAt: attempts.createdAt,
      completedAt: attempts.completedAt,
      setName: questionSets.name,
      paperName: questionSets.paperName,
      condition: attempts.condition,
      experimentId: attempts.experimentId,
      takerUsername: attempts.takerUsername,
      participantId: experiments.participantId,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    // Left join: most attempts are standalone and have no experiment.
    .leftJoin(experiments, eq(experiments.id, attempts.experimentId))
    .where(eq(questionSets.ownerUserId, ownerUserId))
    .orderBy(desc(attempts.createdAt))
    .limit(LIST_LIMIT);

  const answered = await db
    .select({ attemptId: attemptAnswers.attemptId, total: count() })
    .from(attemptAnswers)
    .where(isNotNull(attemptAnswers.submittedAt))
    .groupBy(attemptAnswers.attemptId);
  const answeredByAttempt = new Map(answered.map((row) => [row.attemptId, row.total]));

  return rows.map((row) => ({
    id: row.id,
    questionSetId: row.questionSetId,
    setLabel: questionSetLabel(row.setName, row.paperName),
    paperName: row.paperName,
    participantId: row.participantId ?? null,
    takerUsername: row.takerUsername ?? null,
    condition: (row.condition as AttemptCondition | null) ?? null,
    status: row.status,
    score: row.score,
    randomize: row.randomize,
    linkEnabled: row.linkEnabled,
    answeredCount: answeredByAttempt.get(row.id) ?? 0,
    totalQuestions: (JSON.parse(row.questionOrderJson) as string[]).length,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }));
}

export async function listTakerAttempts(takerUserId: string): Promise<AttemptListEntry[]> {
  const rows = await db
    .select({
      id: attempts.id,
      questionSetId: attempts.questionSetId,
      status: attempts.status,
      score: attempts.score,
      randomize: attempts.randomize,
      linkEnabled: attempts.linkEnabled,
      questionOrderJson: attempts.questionOrderJson,
      createdAt: attempts.createdAt,
      completedAt: attempts.completedAt,
      setName: questionSets.name,
      paperName: questionSets.paperName,
      condition: attempts.condition,
      experimentId: attempts.experimentId,
      takerUsername: attempts.takerUsername,
      participantId: experiments.participantId,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .leftJoin(experiments, eq(experiments.id, attempts.experimentId))
    .where(eq(attempts.takerUserId, takerUserId))
    .orderBy(desc(attempts.createdAt))
    .limit(LIST_LIMIT);
  const answered = await db
    .select({ attemptId: attemptAnswers.attemptId, total: count() })
    .from(attemptAnswers)
    .where(isNotNull(attemptAnswers.submittedAt))
    .groupBy(attemptAnswers.attemptId);
  const answeredByAttempt = new Map(answered.map((row) => [row.attemptId, row.total]));
  const evaluating = rows.length
    ? await db
        .select({ attemptId: jobs.attemptId })
        .from(jobs)
        .where(
          and(
            inArray(jobs.attemptId, rows.map((row) => row.id)),
            inArray(jobs.status, ["queued", "running"]),
          ),
        )
    : [];
  const evaluatingIds = new Set(evaluating.map((row) => row.attemptId));
  return rows.map((row) => ({
    id: row.id,
    questionSetId: row.questionSetId,
    setLabel: questionSetLabel(row.setName, row.paperName),
    paperName: row.experimentId ? "Assessment paper" : row.paperName,
    participantId: row.participantId ?? null,
    takerUsername: row.takerUsername ?? null,
    condition: (row.condition as AttemptCondition | null) ?? null,
    status: evaluatingIds.has(row.id) ? "evaluating" : row.status,
    score: row.score,
    randomize: row.randomize,
    linkEnabled: row.linkEnabled,
    answeredCount: answeredByAttempt.get(row.id) ?? 0,
    totalQuestions: (JSON.parse(row.questionOrderJson) as string[]).length,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }));
}
