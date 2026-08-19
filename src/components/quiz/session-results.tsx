"use client";

import { ResultSections } from "@/components/quiz/quiz-workspace";
import type { AssessmentResult } from "@/lib/quiz";

export type SessionBlock = {
  /** "Block 1 · Own paper" — set by the caller, which knows the experiment. */
  label: string;
  result: AssessmentResult;
};

/**
 * The reveal page for a chained experiment run: both blocks' scores side by side, then each
 * block's full answer review in the order they were taken.
 *
 * One page rather than two, because the session has a single grade-reveal step (research plan
 * §8.4) and burying the first block's review on the dashboard would mean the participant never
 * sees half of what they just did.
 */
export function SessionResults({
  blocks,
  participantId,
  onDone,
}: {
  blocks: SessionBlock[];
  participantId?: string;
  onDone?: () => void;
}) {
  return (
    <main className="app-shell">
      <section className="card session-summary">
        <p className="eyebrow">Session complete</p>
        <h1>Both papers finished</h1>
        <div className="session-scores">
          {blocks.map((block) => (
            <div className="session-score" key={block.result.attemptId}>
              <span className="session-score-label">{block.label}</span>
              <strong>{block.result.overallScore}%</strong>
              <span className="session-score-meta">
                {block.result.scoredQuestionCount} scored{" "}
                {block.result.scoredQuestionCount === 1 ? "question" : "questions"}
                {block.result.warmupQuestionCount > 0 &&
                  `, ${block.result.warmupQuestionCount} warm-up not counted`}
              </span>
            </div>
          ))}
        </div>
        {participantId && <p className="hint">Participant {participantId}</p>}
      </section>

      {blocks.map((block) => (
        <ResultSections key={block.result.attemptId} result={block.result} label={block.label} />
      ))}

      {onDone && (
        <div className="quiz-actions sequential-actions">
          <button className="secondary" type="button" onClick={onDone}>
            Back to dashboard
          </button>
        </div>
      )}
    </main>
  );
}
