"use client";

import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";

import { ParticipantId } from "@/components/participant-id";
import { MathText } from "@/components/quiz/math-text";
import {
  CONDITION_LABELS,
  FOREIGN_STRATUM_LABELS,
  type AssessmentResult,
  type AttemptOutline,
} from "@/lib/quiz";

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
  onBack,
}: {
  outline: AttemptOutline;
  /**
   * Hands the attempt over rather than opening it here. The caller decides between the landing
   * page and resuming mid-question, so pressing Start does not itself begin question one's
   * clock — the participant does, from the landing page.
   */
  onStart: (attemptId: string) => Promise<void> | void;
  onResult: (result: AssessmentResult) => void;
  onBack: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [participantLink, setParticipantLink] = useState("");
  // The outline is re-fetched every time this page opens, so props are a fresh starting point.
  const [linkEnabled, setLinkEnabled] = useState(outline.linkEnabled);
  const [linkWorking, setLinkWorking] = useState(false);

  // Built in the browser so the host matches however this deployment is reached.
  useEffect(() => {
    const origin = outline.participantBaseUrl || window.location.origin;
    setParticipantLink(`${origin}/attempt/${outline.attemptId}`);
  }, [outline.attemptId, outline.participantBaseUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(participantLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy automatically — select the link and copy it manually.");
    }
  }

  /**
   * Opens or closes the link. Closing takes effect at the participant's next request, so it
   * also stops a session that is already running.
   */
  async function toggleLink() {
    const next = !linkEnabled;
    setLinkWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/attempts/${outline.attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkEnabled: next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update the link.");
      setLinkEnabled(payload.linkEnabled as boolean);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the link.");
    } finally {
      setLinkWorking(false);
    }
  }

  const started = outline.answeredCount > 0;
  const complete = outline.graded || outline.gradable;

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
      onResult(payload.result as AssessmentResult);
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
        {/*
          One element in the header's second column. Adding the experiment badge as a third
          child of a two-column grid pushed the progress onto an implicit row inside the wide
          left column, where it read as misaligned rather than top-right.
        */}
        <div className="summary-header-side">
          {/* Which block of whose session this is, so the right one is handed over. */}
          {outline.experiment && (
            <div className="summary-experiment">
              <ParticipantId id={outline.experiment.participantId} />
              <span className="pill">
                Block {outline.experiment.blockPosition} ·{" "}
                {CONDITION_LABELS[outline.experiment.condition]}
              </span>
              {outline.experiment.condition === "foreign" && (
                <span className="catalog-meta">
                  {FOREIGN_STRATUM_LABELS[outline.experiment.foreignStratum].toLowerCase()}
                </span>
              )}
            </div>
          )}
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

      <p className="lede summary-notice">
        This page is for the researcher. It names each item and what it probes, so do not
        leave it on screen once the assessment is handed over.
      </p>

      {!outline.graded && (
        <section className="card participant-link">
          <div className="field">
            <label htmlFor="participantLink">Participant link</label>
            <div className="participant-link-row">
              <input
                className="control"
                id="participantLink"
                value={participantLink}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button className="secondary" type="button" onClick={copyLink}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="link-state-row">
              <span className={`link-state ${linkEnabled ? "open" : "closed"}`}>
                {linkEnabled ? "Enabled" : "Disabled"}
              </span>
              <button
                className={`secondary ${linkEnabled ? "danger" : ""}`}
                type="button"
                disabled={linkWorking}
                onClick={() => void toggleLink()}
              >
                {linkWorking ? "Saving…" : linkEnabled ? "Disable link" : "Enable link"}
              </button>
            </div>
            <small>
              {linkEnabled
                ? "Anyone holding this link can answer the attempt right now, with no password. Disable it when the session ends."
                : "Safe to send now: whoever opens it sees a “not open yet” page until you enable the link. Enable it when the session starts."}{" "}
              The button at the bottom of this page works either way, for in-person sessions.
            </small>
          </div>
        </section>
      )}

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
        <span className="hint">
          {complete
            ? outline.graded
              ? "This attempt is graded. Its answers are locked."
              : "Every question is answered. Grading has not run yet."
            : started
              ? "Answered questions stay locked; the assessment resumes at the next one."
              : "Opens on a landing page. Timing starts when the participant presses Start."}
        </span>
        <button className="secondary" type="button" disabled={working} onClick={onBack}>
          Back to dashboard
        </button>
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
