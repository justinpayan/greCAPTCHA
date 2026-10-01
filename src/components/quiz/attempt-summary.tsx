"use client";

import { useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { CostEstimateNotice, useGradingCostEstimate } from "@/components/cost-estimate-notice";
import { OpenRouterKeyPanel } from "@/components/openrouter-key-panel";
import { MathText } from "@/components/quiz/math-text";
import {
  validateBrowserOpenRouterKey,
  type KeySource,
} from "@/lib/openrouter-browser-key";
import { errorFromPayload, isOpenRouterError } from "@/lib/openrouter-errors";
import type { AssessmentResult, AttemptOutline } from "@/lib/quiz";
import { userFacingMessage } from "@/lib/user-facing-error";

const TYPE_LABELS = {
  fill_blank: "Fill in the blank",
  multiple_choice: "Multiple choice",
  free_response: "Free response",
} as const;

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
  // OpenRouter problems, shown under the key controls when this attempt is graded with the
  // examinee's own key.
  const [keyError, setKeyError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keySource, setKeySource] = useState<KeySource>("paste");
  const [browserKeyAvailable, setBrowserKeyAvailable] = useState<boolean | null>(null);
  const [creatorCredentialAvailability, setCreatorCredentialAvailability] = useState<
    "checking" | "available" | "unavailable" | "unknown"
  >("checking");
  const takerPaysForGrading =
    outline.apiKeyPayer === "taker" && outline.gradable && !outline.graded;
  const gradingEstimate = useGradingCostEstimate(outline.attemptId, takerPaysForGrading);

  const started = outline.answeredCount > 0;
  const complete = outline.graded || outline.gradable;
  useEffect(() => {
    if (outline.apiKeyPayer !== "creator" || !outline.gradable || outline.graded) return;
    let active = true;
    setCreatorCredentialAvailability("checking");
    void fetch("/api/openrouter/credential", { cache: "no-store" })
      .then(async (response) => {
        const status = (await response.json()) as
          | { connected: false }
          | { connected: true; expiresAt: string };
        if (!response.ok) throw new Error("Unable to load OpenRouter status.");
        if (!active) return;
        const available =
          status.connected && new Date(status.expiresAt).getTime() > Date.now();
        setCreatorCredentialAvailability(available ? "available" : "unavailable");
      })
      .catch(() => {
        if (active) setCreatorCredentialAvailability("unknown");
      });
    return () => {
      active = false;
    };
  }, [outline.apiKeyPayer, outline.gradable, outline.graded]);

  const awaitingEvaluationHint =
    outline.apiKeyPayer === "creator"
      ? creatorCredentialAvailability === "available"
        ? "Your saved OpenRouter API key is ready. Run the evaluation."
        : creatorCredentialAvailability === "unavailable"
          ? "Reconnect your OpenRouter API key under API Access on the dashboard, then run the evaluation."
          : creatorCredentialAvailability === "checking"
            ? "Checking your saved OpenRouter API access…"
            : "Run the evaluation using the OpenRouter API key configured under API Access."
      : apiKey.trim()
        ? "Your OpenRouter API key is ready. Run the evaluation."
        : browserKeyAvailable
          ? "A connected OpenRouter API key is available below. Select “Use this key,” then run the evaluation."
          : browserKeyAvailable === null
            ? "Checking for a connected OpenRouter API key…"
            : "Connect with OpenRouter or paste an API key below, then run the evaluation.";
  const feedbackCommentCount = outline.examineeFeedback
    ? Object.keys(outline.examineeFeedback.commentsByQuestionId).length
    : 0;
  const actionLabel = working
    ? complete
      ? "Loading results…"
      : "Opening…"
    : outline.graded
      ? "Show results"
      : outline.gradable
        ? "Run evaluation"
        : started
          ? "Resume attempt"
          : "Start attempt";

  async function beginOrResume() {
    setWorking(true);
    setError("");
    try {
      await onStart(outline.attemptId);
    } catch (caught) {
      setError(userFacingMessage(caught, "Unable to open the attempt."));
    } finally {
      setWorking(false);
    }
  }

  async function showGrading() {
    setWorking(true);
    setError("");
    setKeyError("");
    try {
      const response = outline.graded
        ? await fetch(`/api/attempts/${outline.attemptId}/grading`, {
            cache: "no-store",
          })
        : await (async () => {
            const keyForJob =
              outline.apiKeyPayer === "taker"
                ? keySource === "oauth"
                  ? (await validateBrowserOpenRouterKey()).key
                  : apiKey
                : "";
            return fetch(`/api/attempts/${outline.attemptId}/outline`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ openrouterApiKey: keyForJob, keySource }),
            });
          })();
      const payload = await response.json();
      if (!response.ok) throw errorFromPayload(payload, "Unable to grade the attempt.");
      if (!outline.graded && keySource === "paste") setApiKey("");
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
        if (!poll.ok) throw errorFromPayload(status, "Unable to check grading.");
        if (status.status === "failed") throw errorFromPayload(status, "Grading failed.");
        if (status.result) {
          onResult(status.result as AssessmentResult);
          return;
        }
      }
    } catch (caught) {
      const message = userFacingMessage(caught, "Unable to grade the attempt.");
      // The key panel is only on screen for a conference attempt that still needs grading.
      const panelShown =
        outline.apiKeyPayer === "taker" && outline.gradable && !outline.graded;
      if (isOpenRouterError(caught) && panelShown) setKeyError(message);
      else setError(message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="app-shell dashboard-shell">
      <Brand onHome={onBack} />

      <header className="quiz-header sequential-header">
        <div>
          <h1>{outline.setLabel}</h1>
          <div className="quiz-meta">
            {/* Only worth showing when the set was named, otherwise it repeats the title. */}
            {outline.setLabel !== outline.paperName && `${outline.paperName} · `}
            {outline.modelId}
          </div>
          {outline.takerUsername && (
            <p className="completed-by">
              Completed by user <strong>{outline.takerUsername}</strong>
            </p>
          )}
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

      {/* Status, tested material, and examinee feedback share one card, divided into sections. */}
      <section className="card report-card">
        <div className="attempt-start-row">
          <div>
            <strong>
              {outline.graded
                ? "Completed attempt"
                : outline.gradable
                  ? "Awaiting evaluation"
                : started
                  ? "Continue where you left off"
                  : "Attempt not yet started"}
            </strong>
            <p className="hint">
              {complete
                ? outline.graded
                  ? "Open the completed attempt to see its score and question-by-question results."
                  : awaitingEvaluationHint
                : "Open the attempt when you are ready. Timing begins after you confirm on the start screen."}
            </p>
          </div>
          <button
            className="primary"
            type="button"
            disabled={
              working ||
              (outline.apiKeyPayer === "taker" &&
                outline.gradable &&
                !outline.graded &&
                !apiKey)
            }
            onClick={complete ? showGrading : beginOrResume}
          >
            {actionLabel}
          </button>
        </div>

        <div className="report-card-section">
          <p className="eyebrow">What material was tested?</p>
          <p className="report-contributions">
            {outline.contributions.trim()
              ? outline.contributions
              : "No test-scope statement was provided, so questions covered the whole manuscript."}
          </p>
        </div>

        {outline.examineeFeedback && (
          <div className="report-card-section">
            <p className="eyebrow">Examinee feedback</p>
            <h2>
              Submitted {new Date(outline.examineeFeedback.submittedAt).toLocaleString()}
            </h2>
            <p>
              {feedbackCommentCount > 0
                ? `${feedbackCommentCount} question ${
                    feedbackCommentCount === 1 ? "comment" : "comments"
                  } submitted below.`
                : "The examinee submitted without comments."}
            </p>
            <p className="hint">This feedback is locked and cannot be edited.</p>
          </div>
        )}
      </section>

      {takerPaysForGrading && (
        <OpenRouterKeyPanel
          estimate={
            gradingEstimate && (
              <CostEstimateNotice estimate={gradingEstimate} includeGeneration={false} />
            )
          }
          apiKey={apiKey}
          source={keySource}
          error={keyError}
          onAvailabilityChange={setBrowserKeyAvailable}
          onChange={(nextKey, nextSource) => {
            setApiKey(nextKey);
            setKeySource(nextSource);
            setKeyError("");
          }}
        />
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
            {outline.examineeFeedback?.commentsByQuestionId[item.questionId] && (
              <div className="summary-question-feedback">
                <span className="review-label">Examinee feedback</span>
                <p>{outline.examineeFeedback.commentsByQuestionId[item.questionId]}</p>
              </div>
            )}
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
