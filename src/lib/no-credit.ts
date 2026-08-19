import "server-only";

import type { StoredQuestion } from "@/lib/quiz";

/**
 * Feedback for a question that scores zero without an answer — skipped, or reached by nobody
 * before the overall budget ran out.
 *
 * Shaped like a wrong answer of the same type so the review screen renders it through its normal
 * path, with the key visible, rather than needing an empty state per question type. Free-response
 * items carry their feedback from here rather than from the grader: marking an empty response
 * against a rubric wastes a call and invites partial credit for nothing.
 */
export function noCreditFeedbackJson(question: StoredQuestion, reason: string): string {
  if (question.type === "fill_blank") {
    return JSON.stringify({
      blanks: question.blanks.map((blank) => ({
        blankId: blank.id,
        selectedAnswer: null,
        correctAnswer: blank.answer,
        correct: false,
      })),
    });
  }
  if (question.type === "multiple_choice") return JSON.stringify({ correct: false });
  return JSON.stringify({ feedback: reason });
}
