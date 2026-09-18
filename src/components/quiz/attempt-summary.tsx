"use client";

import { useState } from "react";

import { Brand } from "@/components/brand";
import { MathText } from "@/components/quiz/math-text";
import type { AssessmentResult, AttemptOutline } from "@/lib/quiz";

const TYPE_LABELS = {
  fill_blank: "Fill in the blank",
  multiple_choice: "Multiple choice",
  free_response: "Free response",
} as const;

function formatLimit(seconds: number | null) {
  if (seconds === null) return "untimed";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Public-demo overview shown before an account owner opens or resumes an attempt. */
export function AttemptSummary({
  outline,
  onStart,
  onResult,
  onBack,
}: {
  outline: AttemptOutline;
  onStart: (attemptId: string) => Promise<void> | void;
  onResult: (result: AssessmentResult) => void;
  onBack: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const started = outline.answeredCount > 0;
  const complete = outline.graded || outline.gradable;
  const actionLabel = working
    ? complete
      ? "Loading results…"
      : "Opening…"
    : outline.graded
      ? "Show results"
      : outline.gradable
        ? "Grade and show results"
        : started
          ? "Resume attempt"
          : "Start attempt";

  async function beginOrResume() {
    setWorking(true);
    setError("");
    try {
      await onStart(outline.attemptId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open the attempt.");
    } finally {
      setWorking(false);
    }
  }

  async function showGrading() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/attempts/${outline.attemptId}/outline`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to grade the attempt.");
      if (payload.result) {
        onResult(payload.result as AssessmentResult);
        return;
      }
      while (true) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const poll = await fetch(`/api/attempts/${outline.attemptId}/grading`, {
          cache: "no-store",
        });
        const status = await poll.json();
        if (!poll.ok) throw new Error(status.error ?? "Unable to check grading.");
        if (status.status === "failed") throw new Error(status.error ?? "Grading failed.");
        if (status.result) {
          onResult(status.result as AssessmentResult);
          return;
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to grade the attempt.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="app-shell">
      <Brand onHome={onBack} />

      <header className="quiz-header sequential-header">
        <div>
          <p className="eyebrow">Assessment plan</p>
          <h1>{outline.setLabel}</h1>
          <div className="quiz-meta">
            {/* Only worth showing when the set was named, otherwise it repeats the title. */}
            {outline.setLabel !== outline.paperName && `${outline.paperName} · `}
            {outline.modelId}
          </div>
        </div>
        <div className="summary-header-side">
          <div className="sequence-status">
            <div className="sequence-progress">
              {outline.answeredCount} of {outline.totalQuestions} answered
            </div>
            <div className="question-timer">
              {outline.scoredQuestionCount} scored ·{" "}
              {outline.totalQuestions - outline.scoredQuestionCount} warm-up
            </div>
          </div>
        </div>
      </header>

      <section className="card attempt-start-card">
        <div>
          <strong>{started && !complete ? "Continue where you left off" : "Ready to answer?"}</strong>
          <p className="hint">
            {complete
              ? "Open the completed attempt to see its score and question-by-question results."
              : "Open the attempt when you are ready. Timing begins after you confirm on the start screen."}
          </p>
        </div>
        <button
          className="primary"
          type="button"
          disabled={working}
          onClick={complete ? showGrading : beginOrResume}
        >
          {actionLabel}
        </button>
      </section>

      <section className="summary-list">
        {outline.items.map((item) => (
          <article
            className={`card summary-item type-${item.type} ${
              item.answered ? "answered" : ""
            }`}
            key={item.questionId}
          >
            <div className="summary-item-head">
              <span className="summary-position">{item.position}</span>
              <span className={`type-chip type-${item.type}`}>{TYPE_LABELS[item.type]}</span>
              {item.blockName && <span className="summary-block">{item.blockName}</span>}
              {item.warmup && <span className="pill">Warm-up</span>}
              <span className="summary-limit">{formatLimit(item.timeLimitSeconds)}</span>
              <span className={`summary-state ${item.answered ? "done" : ""}`}>
                {item.answered ? "Answered" : "Pending"}
              </span>
            </div>
            <p className="summary-description">
              {item.description ? (
                <MathText text={item.description} />
              ) : (
                "No description was generated for this item."
              )}
            </p>
          </article>
        ))}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="quiz-actions sequential-actions">
        <button className="secondary" type="button" disabled={working} onClick={onBack}>
          Back to dashboard
        </button>
      </div>
    </main>
  );
}
