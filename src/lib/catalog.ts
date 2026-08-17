import "server-only";

import { count, desc, eq, isNotNull, or } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts, experiments, questionSets } from "@/db/schema";
import type {
  AttemptCondition,
  AttemptListEntry,
  QuestionSetListEntry,
  StoredQuestion,
} from "@/lib/quiz";

const LIST_LIMIT = 200;

/** A set always has something readable to show, even when it was never named. */
export function questionSetLabel(name: string | null, paperName: string) {
  return name?.trim() || paperName;
}

export async function listQuestionSets(): Promise<QuestionSetListEntry[]> {
  const sets = await db
    .select()
    .from(questionSets)
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
    for (const setId of new Set([use.own, use.foreign])) {
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

export async function renameQuestionSet(id: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length > 120) throw new Error("Set names are limited to 120 characters.");
  const result = await db
    .update(questionSets)
    .set({ name: trimmed || null })
    .where(eq(questionSets.id, id))
    .run();
  if (result.changes !== 1) throw new Error("Question set not found.");
  return trimmed;
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
export async function deleteQuestionSet(id: string) {
  const uses = await db
    .select({ participantId: experiments.participantId })
    .from(experiments)
    .where(or(eq(experiments.ownQuestionSetId, id), eq(experiments.foreignQuestionSetId, id)));
  if (uses.length > 0) {
    const named = uses.map((use) => use.participantId).join(", ");
    const plural = uses.length === 1;
    throw new Error(
      `This set is used by ${uses.length} experiment${plural ? "" : "s"} (${named}). Delete ${plural ? "that experiment" : "those experiments"} first.`,
    );
  }
  const result = await db.delete(questionSets).where(eq(questionSets.id, id)).run();
  if (result.changes !== 1) throw new Error("Question set not found.");
}

/**
 * Opens or closes an attempt's participant link.
 *
 * Deliberately allowed on an attempt that is already under way: closing one halts it at the
 * next request, which is how a session that has run out of time is stopped.
 */
export async function setAttemptLinkEnabled(id: string, enabled: boolean) {
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
export async function deleteAttempt(id: string) {
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

export async function listAttempts(): Promise<AttemptListEntry[]> {
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
      setName: questionSets.name,
      paperName: questionSets.paperName,
      condition: attempts.condition,
      participantId: experiments.participantId,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    // Left join: most attempts are standalone and have no experiment.
    .leftJoin(experiments, eq(experiments.id, attempts.experimentId))
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
    condition: (row.condition as AttemptCondition | null) ?? null,
    status: row.status,
    score: row.score,
    randomize: row.randomize,
    linkEnabled: row.linkEnabled,
    answeredCount: answeredByAttempt.get(row.id) ?? 0,
    totalQuestions: (JSON.parse(row.questionOrderJson) as string[]).length,
    createdAt: row.createdAt,
  }));
}
