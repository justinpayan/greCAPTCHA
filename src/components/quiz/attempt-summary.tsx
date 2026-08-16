"use client";

import { useState } from "react";

import type { AssessmentResult, AttemptOutline, AttemptView } from "@/lib/quiz";

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

/**
 * Researcher-facing plan of an attempt, shown before the assessment is handed over. It
 * carries card names and generated item descriptions, so it must never be on screen while
 * the participant is working.
 */
export function AttemptSummary({
  outline,
  onStart,
  onResult,
}: {
  outline: AttemptOutline;
  onStart: (attempt: AttemptView) => void;
  onResult: (result: AssessmentResult) => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const started = outline.answeredCount > 0;
  const complete = outline.graded || outline.gradable;

  async function beginOrResume() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/attempts/${outline.attemptId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to open the attempt.");
      if (payload.result) onResult(payload.result as AssessmentResult);
      else onStart(payload.attempt as AttemptView);
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
      onResult(payload.result as AssessmentResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to grade the attempt.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>

      <header className="quiz-header sequential-header">
        <div>
          <p className="eyebrow">Assessment plan</p>
          <h1>{outline.paperName}</h1>
          <div className="quiz-meta">{outline.modelId}</div>
        </div>
        <div className="sequence-status">
          <div className="sequence-progress">
            {outline.answeredCount} of {outline.totalQuestions} answered
          </div>
          <div className="question-timer">
            {outline.scoredQuestionCount} scored ·{" "}
            {outline.totalQuestions - outline.scoredQuestionCount} warm-up
          </div>
        </div>
      </header>

      <p className="lede summary-notice">
        This page is for the researcher. It names each item and what it probes, so do not
        leave it on screen once the assessment is handed over.
      </p>

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
              {item.description || "No description was generated for this item."}
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
        <span className="hint">
          {complete
            ? outline.graded
              ? "This attempt is graded. Its answers are locked."
              : "Every question is answered. Grading has not run yet."
            : started
              ? "Answered questions stay locked; the assessment resumes at the next one."
              : "Timing starts when the first question is shown."}
        </span>
        <button
          className="primary"
          type="button"
          disabled={working}
          onClick={complete ? showGrading : beginOrResume}
        >
          {working
            ? complete
              ? "Loading results…"
              : "Opening…"
            : outline.graded
              ? "Show results"
              : outline.gradable
                ? "Grade and show results"
                : started
                  ? "Resume assessment"
                  : "Start assessment"}
        </button>
      </div>
    </main>
  );
}
