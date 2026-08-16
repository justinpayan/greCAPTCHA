import "server-only";

import { count, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts, questionSets } from "@/db/schema";
import type {
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

  return sets.map((set) => ({
    id: set.id,
    name: set.name?.trim() ?? "",
    label: questionSetLabel(set.name, set.paperName),
    paperName: set.paperName,
    modelId: set.modelId,
    questionCount: (JSON.parse(set.questionsJson) as StoredQuestion[]).length,
    attemptCount: countBySet.get(set.id) ?? 0,
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

export async function listAttempts(): Promise<AttemptListEntry[]> {
  const rows = await db
    .select({
      id: attempts.id,
      questionSetId: attempts.questionSetId,
      status: attempts.status,
      score: attempts.score,
      randomize: attempts.randomize,
      questionOrderJson: attempts.questionOrderJson,
      createdAt: attempts.createdAt,
      setName: questionSets.name,
      paperName: questionSets.paperName,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
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
    status: row.status,
    score: row.score,
    randomize: row.randomize,
    answeredCount: answeredByAttempt.get(row.id) ?? 0,
    totalQuestions: (JSON.parse(row.questionOrderJson) as string[]).length,
    createdAt: row.createdAt,
  }));
}
