import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts, experiments, questionSets } from "@/db/schema";
import { questionSetLabel } from "@/lib/catalog";
import {
  foreignStrata,
  type ExperimentAllocation,
  type ExperimentAttempt,
  type ExperimentListEntry,
  type ExperimentSessionPlan,
  type ForeignStratum,
  type StoredQuestion,
  isWarmup,
  shuffled,
} from "@/lib/quiz";

/**
 * Experiments pair one participant's own paper with an unfamiliar paper (research plan §8.2,
 * where it is called the foreign paper — the data model keeps `foreign` throughout, the
 * interface says "unfamiliar").
 *
 * Two allocations are balanced rather than left to independent coin flips, because with
 * N≈24 a fair coin lands on 16/8 splits often enough to matter:
 *
 * - **Stratum** (in-field / out-of-field) is balanced across all experiments.
 * - **Block order** is balanced *within* each stratum, which keeps it balanced overall as
 *   well and additionally prevents order from correlating with stratum.
 *
 * Both use minority-fill: whichever cell has fewer experiments is assigned next, and a tie is
 * broken at random. That holds every cell within one of every other at all times, so a study
 * that stops early — or at an odd N — is still as balanced as it can be.
 */

/**
 * Unambiguous alphabet: no O/0 or I/1/L, since participant IDs get read aloud and written on
 * consent forms. 32^4 ≈ 1.05M codes, so collisions are rare and retried against the unique
 * index rather than assumed away.
 */
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ID_LENGTH = 4;
const ID_ATTEMPTS = 40;

function randomParticipantId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

/** Fewer wins; a tie returns null so the caller decides at random. */
function minority<T>(a: { key: T; total: number }, b: { key: T; total: number }): T | null {
  if (a.total === b.total) return null;
  return a.total < b.total ? a.key : b.key;
}

function coinFlip(): boolean {
  const bytes = new Uint8Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return bytes[0] % 2 === 0;
}

async function stratumCounts() {
  const rows = await db
    .select({ stratum: experiments.foreignStratum, total: count() })
    .from(experiments)
    .groupBy(experiments.foreignStratum);
  const byStratum = new Map(rows.map((row) => [row.stratum, row.total]));
  return {
    in_field: byStratum.get("in_field") ?? 0,
    out_of_field: byStratum.get("out_of_field") ?? 0,
  };
}

/**
 * What the next experiment will get, for display on the creation form.
 *
 * Only the stratum is previewed, and only when it is actually determined: the researcher has
 * to choose an unfamiliar paper from the right stratum before creating the experiment, so this
 * is the one allocation they need in advance. Block order constrains nothing beforehand and is
 * revealed on creation.
 */
export async function experimentAllocation(): Promise<ExperimentAllocation> {
  const strata = await stratumCounts();
  const orderRows = await db
    .select({ foreignFirst: experiments.foreignFirst, total: count() })
    .from(experiments)
    .groupBy(experiments.foreignFirst);
  const foreignFirst = orderRows.find((row) => row.foreignFirst)?.total ?? 0;
  const ownFirst = orderRows.find((row) => !row.foreignFirst)?.total ?? 0;

  return {
    nextForeignStratum: minority<ForeignStratum>(
      { key: "in_field", total: strata.in_field },
      { key: "out_of_field", total: strata.out_of_field },
    ),
    counts: {
      total: strata.in_field + strata.out_of_field,
      inField: strata.in_field,
      outOfField: strata.out_of_field,
      foreignFirst,
      ownFirst,
    },
  };
}

/** Balanced within the stratum the experiment is being assigned to. */
async function allocateForeignFirst(stratum: ForeignStratum): Promise<boolean> {
  const rows = await db
    .select({ foreignFirst: experiments.foreignFirst, total: count() })
    .from(experiments)
    .where(eq(experiments.foreignStratum, stratum))
    .groupBy(experiments.foreignFirst);
  const decided = minority(
    { key: true, total: rows.find((row) => row.foreignFirst)?.total ?? 0 },
    { key: false, total: rows.find((row) => !row.foreignFirst)?.total ?? 0 },
  );
  return decided ?? coinFlip();
}

async function allocateStratum(): Promise<ForeignStratum> {
  const strata = await stratumCounts();
  const decided = minority<ForeignStratum>(
    { key: "in_field", total: strata.in_field },
    { key: "out_of_field", total: strata.out_of_field },
  );
  return decided ?? (coinFlip() ? "in_field" : "out_of_field");
}

/** The question order for one attempt: warm-ups first, scored items optionally shuffled. */
function questionOrder(set: { questionsJson: string }, randomize: boolean): string[] {
  const questions = JSON.parse(set.questionsJson) as StoredQuestion[];
  const warmups = questions.filter(isWarmup).map((question) => question.id);
  const scored = questions.filter((question) => !isWarmup(question)).map((q) => q.id);
  return [...warmups, ...(randomize ? shuffled(scored) : scored)];
}

/**
 * Creates an experiment and its two attempts.
 *
 * Both links start disabled, like any other attempt, so the pair can be prepared the night
 * before and armed block by block during the session. Neither attempt serves a question here,
 * so no clock starts.
 */
export async function createExperiment(input: {
  ownQuestionSetId: string;
  foreignQuestionSetId: string;
  randomize: boolean;
  countdownHidden: boolean;
}): Promise<{ experimentId: string; participantId: string }> {
  if (input.ownQuestionSetId === input.foreignQuestionSetId) {
    throw new Error("An experiment needs two different question sets.");
  }

  const sets = await db
    .select()
    .from(questionSets)
    .where(inArray(questionSets.id, [input.ownQuestionSetId, input.foreignQuestionSetId]));
  const own = sets.find((set) => set.id === input.ownQuestionSetId);
  const foreign = sets.find((set) => set.id === input.foreignQuestionSetId);
  if (!own) throw new Error("The own-paper question set was not found.");
  if (!foreign) throw new Error("The unfamiliar-paper question set was not found.");

  const foreignStratum = await allocateStratum();
  const foreignFirst = await allocateForeignFirst(foreignStratum);
  const experimentId = randomUUID();
  const createdAt = new Date().toISOString();

  const participantId = await insertWithParticipantId(async (candidate) => {
    await db
      .insert(experiments)
      .values({
        id: experimentId,
        participantId: candidate,
        ownQuestionSetId: own.id,
        foreignQuestionSetId: foreign.id,
        foreignFirst,
        foreignStratum,
        createdAt,
      })
      .run();
  });

  for (const [condition, set] of [
    ["own", own],
    ["foreign", foreign],
  ] as const) {
    await db.insert(attempts).values({
      id: randomUUID(),
      questionSetId: set.id,
      experimentId,
      condition,
      randomize: input.randomize,
      countdownHidden: input.countdownHidden,
      linkEnabled: false,
      questionOrderJson: JSON.stringify(questionOrder(set, input.randomize)),
      currentIndex: 0,
      status: "active",
      createdAt,
    });
  }

  return { experimentId, participantId };
}

/**
 * Retries the insert on a participant-ID collision.
 *
 * The unique index is the authority rather than a pre-flight "is this taken" query, which
 * could pass and then lose the race to a second creation.
 */
async function insertWithParticipantId(
  insert: (candidate: string) => Promise<void>,
): Promise<string> {
  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
    const candidate = randomParticipantId();
    try {
      await insert(candidate);
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("UNIQUE") && !message.includes("constraint")) throw error;
    }
  }
  throw new Error("Could not allocate an unused participant ID.");
}

export async function listExperiments(): Promise<ExperimentListEntry[]> {
  const rows = await db
    .select()
    .from(experiments)
    .orderBy(desc(experiments.createdAt))
    .limit(200);
  if (rows.length === 0) return [];

  const experimentIds = rows.map((row) => row.id);
  const attemptRows = await db
    .select({
      id: attempts.id,
      experimentId: attempts.experimentId,
      condition: attempts.condition,
      questionSetId: attempts.questionSetId,
      status: attempts.status,
      score: attempts.score,
      linkEnabled: attempts.linkEnabled,
      questionOrderJson: attempts.questionOrderJson,
      setName: questionSets.name,
      paperName: questionSets.paperName,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .where(inArray(attempts.experimentId, experimentIds))
    .orderBy(asc(attempts.createdAt));

  const answered = await db
    .select({ attemptId: attemptAnswers.attemptId, total: count() })
    .from(attemptAnswers)
    .where(isNotNull(attemptAnswers.submittedAt))
    .groupBy(attemptAnswers.attemptId);
  const answeredByAttempt = new Map(answered.map((row) => [row.attemptId, row.total]));

  return rows.map((experiment) => {
    const mine = attemptRows.filter((row) => row.experimentId === experiment.id);
    const attemptViews = mine.map((row): ExperimentAttempt => {
      const condition = row.condition === "foreign" ? "foreign" : "own";
      const isFirst = condition === "foreign" ? experiment.foreignFirst : !experiment.foreignFirst;
      return {
        attemptId: row.id,
        condition,
        blockPosition: isFirst ? 1 : 2,
        questionSetId: row.questionSetId,
        setLabel: questionSetLabel(row.setName, row.paperName),
        paperName: row.paperName,
        status: row.status,
        score: row.score,
        linkEnabled: row.linkEnabled,
        answeredCount: answeredByAttempt.get(row.id) ?? 0,
        totalQuestions: (JSON.parse(row.questionOrderJson) as string[]).length,
      };
    });

    return {
      id: experiment.id,
      participantId: experiment.participantId,
      foreignStratum: (foreignStrata as readonly string[]).includes(experiment.foreignStratum)
        ? (experiment.foreignStratum as ForeignStratum)
        : "in_field",
      foreignFirst: experiment.foreignFirst,
      createdAt: experiment.createdAt,
      attempts: attemptViews.sort((a, b) => a.blockPosition - b.blockPosition),
    };
  });
}

/**
 * The block order behind a single chained participant link.
 *
 * Returns attempt IDs and positions only. Everything else the participant needs comes from the
 * ordinary per-attempt endpoints, which gate themselves on their own link switch, so a chained
 * link grants exactly what holding both individual links would.
 */
export async function getExperimentSession(id: string): Promise<ExperimentSessionPlan> {
  const experiment = await db
    .select()
    .from(experiments)
    .where(eq(experiments.id, id))
    .get();
  if (!experiment) throw new Error("Experiment not found.");

  const rows = await db
    .select({ id: attempts.id, condition: attempts.condition })
    .from(attempts)
    .where(eq(attempts.experimentId, id));

  const blocks = rows
    .map((row) => ({
      attemptId: row.id,
      position: (row.condition === "foreign") === experiment.foreignFirst ? 1 : 2,
    }))
    .sort((a, b) => a.position - b.position);

  return { experimentId: id, blocks };
}

/** Submitted answers across both attempts, so a deletion can say what it destroys. */
export async function experimentAnswerCount(id: string): Promise<number> {
  const row = await db
    .select({ total: count() })
    .from(attemptAnswers)
    .innerJoin(attempts, eq(attempts.id, attemptAnswers.attemptId))
    .where(and(eq(attempts.experimentId, id), isNotNull(attemptAnswers.submittedAt)))
    .get();
  return row?.total ?? 0;
}

/**
 * Deletes an experiment together with both attempts and all of their answers.
 *
 * The attempts go first and explicitly. `attempts.experiment_id` carries no `ON DELETE`
 * action — SQLite cannot attach one to a column added by `ALTER TABLE` — so nothing would
 * cascade, and deleting the experiment on its own would fail the foreign-key check. Answers
 * still cascade from their attempt, which was declared when that table was created.
 */
export async function deleteExperiment(id: string) {
  const existing = await db
    .select({ id: experiments.id })
    .from(experiments)
    .where(eq(experiments.id, id))
    .get();
  if (!existing) throw new Error("Experiment not found.");

  await db.delete(attempts).where(eq(attempts.experimentId, id)).run();
  const result = await db.delete(experiments).where(eq(experiments.id, id)).run();
  if (result.changes !== 1) throw new Error("Experiment not found.");
}
