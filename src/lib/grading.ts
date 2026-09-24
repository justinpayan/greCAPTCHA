import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers, attempts } from "@/db/schema";
import { buildResult, loadAttemptContext } from "@/lib/attempts";
import { backupInBackground } from "@/lib/backup";
import { gradeFreeResponseBlock } from "@/lib/openrouter";
import type { AssessmentResult, StoredFreeResponseQuestion } from "@/lib/quiz";

/**
 * Grades every free-response block, writes the assessment result, and marks the attempt
 * graded. Reachable from the final answer submission and from the summary page, so an
 * attempt whose grading call failed can be finalized without re-answering anything.
 */
export async function finalizeAttempt(
  input: Awaited<ReturnType<typeof loadAttemptContext>>,
  apiKey: string,
) {
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

  for (const blockQuestions of freeByBlock.values()) {
    // A skipped question, or one the overall budget never reached, already holds its score and
    // feedback, so it is withheld from the grader: an empty response marked against a rubric is
    // a wasted call and an invitation to award partial credit for nothing. A block with nothing
    // gradable makes no request at all.
    const questions = blockQuestions.filter((question) => {
      const answer = answerByQuestion.get(question.id);
      return !answer?.skipped && !answer?.timedOut;
    });
    if (questions.length === 0) continue;

    const responses: Record<string, string> = {};
    for (const question of questions) {
      const answer = answerByQuestion.get(question.id);
      responses[question.id] = answer
        ? ((JSON.parse(answer.answerJson ?? "{}") as { response?: string }).response ?? "")
        : "";
    }
    const grades = await gradeFreeResponseBlock({
      apiKey,
      modelId: input.set.modelId,
      questions,
      answers: responses,
    });
    // Only apply grades for questions actually sent. A model that echoes an ID it was not
    // given must not be able to overwrite a skipped question's score.
    const gradable = new Set(questions.map((question) => question.id));
    for (const grade of grades.grades) {
      if (!gradable.has(grade.questionId)) continue;
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
    takerUsername: input.attempt.takerUsername,
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
      completedAt: input.attempt.completedAt ?? new Date().toISOString(),
    })
    .where(eq(attempts.id, input.attempt.id))
    .run();

  // A completed submission is the point at which there is new data worth losing, so it is also
  // the point to back up. Deliberately not awaited: the participant sees their result without
  // waiting on a file copy, and a backup that fails cannot fail the grading that earned it.
  backupInBackground("grading");

  return result;
}


/** Runs grading if needed, or returns the stored result when the attempt is already graded. */
export async function ensureGraded(attemptId: string, apiKey: string): Promise<AssessmentResult> {
  const quiz = await loadAttemptContext(attemptId);
  if (quiz.attempt.status === "graded" && quiz.attempt.gradingJson) {
    const result = JSON.parse(quiz.attempt.gradingJson) as AssessmentResult;
    return {
      ...result,
      takerUsername: result.takerUsername ?? quiz.attempt.takerUsername,
    };
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
  return finalizeAttempt(quiz, apiKey);
}
