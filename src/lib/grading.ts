import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts } from "@/db/schema";
import { buildResult, loadAttemptContext } from "@/lib/attempts";
import { gradeFreeResponseBlock } from "@/lib/openrouter";
import type { AssessmentResult, StoredFreeResponseQuestion } from "@/lib/quiz";

/**
 * Grades every free-response block, writes the assessment result, and marks the attempt
 * graded. Reachable from the final answer submission and from the summary page, so an
 * attempt whose grading call failed can be finalized without re-answering anything.
 */
export async function finalizeAttempt(input: Awaited<ReturnType<typeof loadAttemptContext>>) {
  const allAnswers = await db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, input.attempt.id));

  const answerByQuestion = new Map(allAnswers.map((answer) => [answer.questionId, answer]));
  const freeByBlock = new Map<string, StoredFreeResponseQuestion[]>();
  for (const question of input.questions) {
    if (question.type !== "free_response") continue;
    freeByBlock.set(question.blockId, [...(freeByBlock.get(question.blockId) ?? []), question]);
  }

  for (const questions of freeByBlock.values()) {
    const responses: Record<string, string> = {};
    for (const question of questions) {
      const answer = answerByQuestion.get(question.id);
      responses[question.id] = answer
        ? ((JSON.parse(answer.answerJson ?? "{}") as { response?: string }).response ?? "")
        : "";
    }
    const grades = await gradeFreeResponseBlock({
      modelId: input.set.modelId,
      questions,
      answers: responses,
    });
    for (const grade of grades.grades) {
      await db
        .update(attemptAnswers)
        .set({
          score: grade.score,
          feedbackJson: JSON.stringify({ feedback: grade.feedback }),
        })
        .where(
          and(
            eq(attemptAnswers.attemptId, input.attempt.id),
            eq(attemptAnswers.questionId, grade.questionId),
          ),
        )
        .run();
    }
  }

  const gradedAnswers = await db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, input.attempt.id));
  const result = buildResult({
    attemptId: input.attempt.id,
    questionSetId: input.set.id,
    paperName: input.set.paperName,
    order: input.order,
    questions: input.questions,
    answers: gradedAnswers,
  });
  await db
    .update(attempts)
    .set({
      status: "graded",
      score: result.overallScore,
      gradingJson: JSON.stringify(result),
      completedAt: new Date().toISOString(),
    })
    .where(eq(attempts.id, input.attempt.id))
    .run();
  return result;
}


/** Runs grading if needed, or returns the stored result when the attempt is already graded. */
export async function ensureGraded(attemptId: string): Promise<AssessmentResult> {
  const quiz = await loadAttemptContext(attemptId);
  if (quiz.attempt.status === "graded" && quiz.attempt.gradingJson) {
    return JSON.parse(quiz.attempt.gradingJson) as AssessmentResult;
  }
  const answers = await db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));
  const submitted = new Set(
    answers.filter((answer) => answer.submittedAt).map((answer) => answer.questionId),
  );
  if (quiz.order.some((questionId) => !submitted.has(questionId))) {
    throw new Error("The attempt still has unanswered questions.");
  }
  return finalizeAttempt(quiz);
}
