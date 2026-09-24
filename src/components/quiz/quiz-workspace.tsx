"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { MathText } from "@/components/quiz/math-text";
import { OpenRouterKeyPanel } from "@/components/openrouter-key-panel";
import { PdfAssessmentSplit } from "@/components/quiz/pdf-assessment-split";
import {
  validateBrowserOpenRouterKey,
  type KeySource,
} from "@/lib/openrouter-browser-key";
import {
  draftHasAnswer,
  type AssessmentResult,
  type AttemptView,
  type DraftAnswer,
  type ExamineeFeedback,
  type PublicFillQuestion,
  type PublicMultipleChoiceQuestion,
  type QuestionTiming,
  type QuizChoice,
} from "@/lib/quiz";

const QUESTION_LABELS = {
  fill_blank: "Fill in the blank",
  multiple_choice: "Multiple choice",
  free_response: "Free response",
} as const;

type FillSelections = Record<string, string | null>;

function DraggableChoice({
  choice,
  selected,
  onChoose,
}: {
  choice: QuizChoice;
  selected: boolean;
  onChoose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: choice.id,
  });
  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.55 : selected ? 0.32 : undefined,
    position: "relative",
    zIndex: isDragging ? 30 : undefined,
  };
  return (
    <button
      ref={setNodeRef}
      className="choice"
      type="button"
      style={style}
      onClick={onChoose}
      {...listeners}
      {...attributes}
      // After the spread: dnd-kit also sets aria-pressed, and the selection state wins.
      aria-pressed={selected}
    >
      <MathText text={choice.label} />
    </button>
  );
}

function BlankSlot({
  id,
  label,
  onClear,
}: {
  id: string;
  label?: string;
  onClear: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `blank:${id}` });
  return (
    <button
      ref={setNodeRef}
      className={`blank-slot ${isOver ? "drag-over" : ""}`}
      type="button"
      onClick={onClear}
      aria-label={label ? `Filled with ${label}. Select to clear.` : "Empty answer blank"}
    >
      {label ? <MathText text={label} /> : "Drop answer"}
    </button>
  );
}

function FillQuestionEditor({
  question,
  selections,
  onChange,
}: {
  question: PublicFillQuestion;
  selections: FillSelections;
  onChange: (next: FillSelections) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const labels = useMemo(
    () => new Map(question.choices.map((choice) => [choice.id, choice.label])),
    [question],
  );
  const used = new Set(Object.values(selections).filter(Boolean));

  function setBlank(blankId: string, choiceId: string | null) {
    const next = { ...selections };
    for (const candidate of question.blankIds) {
      if (choiceId && next[candidate] === choiceId) next[candidate] = null;
    }
    next[blankId] = choiceId;
    onChange(next);
  }

  function choose(choiceId: string) {
    const existing = question.blankIds.find((blankId) => selections[blankId] === choiceId);
    if (existing) return setBlank(existing, null);
    const target = question.blankIds.find((blankId) => !selections[blankId]) ?? question.blankIds[0];
    if (target) setBlank(target, choiceId);
  }

  function onDragEnd(event: DragEndEvent) {
    const destination = event.over?.id ? String(event.over.id) : "";
    if (destination.startsWith("blank:")) {
      setBlank(destination.slice(6), String(event.active.id));
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="question-copy">
        {question.segments.map((segment, index) =>
          segment.type === "text" ? (
            <span key={`${index}-${segment.value}`}>
              <MathText text={segment.value} />
            </span>
          ) : (
            <BlankSlot
              key={segment.blankId}
              id={segment.blankId}
              label={labels.get(selections[segment.blankId] ?? "")}
              onClear={() => setBlank(segment.blankId, null)}
            />
          ),
        )}
      </div>
      <div className="word-bank">
        <span className="word-bank-label">Word bank · drag or select an answer</span>
        <div className="choices">
          {question.choices.map((choice) => (
            <DraggableChoice
              key={choice.id}
              choice={choice}
              selected={used.has(choice.id)}
              onChoose={() => choose(choice.id)}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function MultipleChoiceQuestion({
  question,
  selectedOptionId,
  onSelect,
}: {
  question: PublicMultipleChoiceQuestion;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
}) {
  return (
    <div className="multiple-choice-question">
      <h2>
        <MathText text={question.prompt} />
      </h2>
      <div className="option-list" role="radiogroup" aria-label="Answer options">
        {question.options.map((option) => (
          <button
            key={option.id}
            className={`option ${selectedOptionId === option.id ? "selected" : ""}`}
            type="button"
            role="radio"
            aria-checked={selectedOptionId === option.id}
            onClick={() => onSelect(option.id)}
          >
            <MathText text={option.label} />
          </button>
        ))}
      </div>
    </div>
  );
}

function formatDuration(durationMs: number) {
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function formatClock(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Both clocks for the whole set: how long has been spent and how much is left.
 *
 * Only shown when a set carries an overall limit. Reaching zero asks the server to close the
 * attempt; the server checks the budget itself and is free to disagree.
 *
 * Elapsed is the sum of the time each question was open, not wall-clock, so it holds still while a
 * session is paused. That is the same figure the limit is enforced against, which is what keeps the
 * two lines adding up to the budget.
 */
function OverallTimer({
  elapsedMs,
  remainingMs,
  limitSeconds,
}: {
  elapsedMs: number;
  remainingMs: number;
  limitSeconds: number;
}) {
  // The remainder is derived from the figure shown above it, not rounded independently, so the two
  // always add up to the budget. Someone watching a clock does that arithmetic.
  const usedSeconds = Math.min(limitSeconds, Math.max(0, Math.round(elapsedMs / 1000)));
  const leftSeconds = limitSeconds - usedSeconds;
  // Enforcement still runs off the unrounded remainder, so display rounding cannot end an
  // assessment early or late.
  const low = remainingMs <= 60_000;
  return (
    <div className="overall-timer">
      <div className="question-timer">
        {formatClock(usedSeconds * 1000)} of {formatDuration(limitSeconds * 1000)} used
      </div>
      <div className={`question-timer overall-remaining ${low ? "over" : ""}`}>
        {formatClock(leftSeconds * 1000)} left for the set
      </div>
    </div>
  );
}

function ReviewTiming({
  timing,
}: {
  timing: QuestionTiming & { skipped?: boolean; timedOut?: boolean };
}) {
  // "Answered in 4s" would misdescribe a question the participant declined or never reached.
  const parts = [
    timing.timedOut
      ? timing.durationMs
        ? `Open for ${formatDuration(timing.durationMs)} when time ran out`
        : "Not reached before time ran out"
      : timing.skipped
        ? `Skipped after ${formatDuration(timing.durationMs)}`
        : `Answered in ${formatDuration(timing.durationMs)}`,
  ];
  if (timing.firstInteractionMs !== null) {
    parts.push(`first input after ${formatDuration(timing.firstInteractionMs)}`);
  }
  return <p className="review-timing">{parts.join(" · ")}</p>;
}

/** Score card plus the full answer review for one attempt, without a page around it. */
function ResultSections({
  result,
  examineeFeedback,
}: {
  result: AssessmentResult;
  examineeFeedback?: {
    commentsByQuestionId: Record<string, string>;
    submitted: boolean;
    loading: boolean;
    label?: string;
    showEmpty?: boolean;
    onChange: (questionId: string, comment: string) => void;
  };
}) {
  return (
    <>
      <section className="card result neutral-result">
        <p className="eyebrow">Assessment complete</p>
        <h1>Overall score</h1>
        {result.takerUsername && <p className="hint">Completed by {result.takerUsername}</p>}
        <div className="score-ring neutral-score">{result.overallScore}%</div>
        <p className="lede" style={{ marginInline: "auto", marginBottom: 0 }}>
          An equal-weight average across the {result.scoredQuestionCount} scored{" "}
          {result.scoredQuestionCount === 1 ? "question" : "questions"}.
          {result.warmupQuestionCount > 0 &&
            ` ${result.warmupQuestionCount} warm-up ${
              result.warmupQuestionCount === 1 ? "question is" : "questions are"
            } shown below but not counted.`}
        </p>
      </section>

      <section className="review-section">
        <div className="review-heading">
          <div>
            <p className="eyebrow">Read-only review</p>
            <h2>Answers and feedback</h2>
          </div>
          <p>All submitted answers are locked.</p>
        </div>
        {result.questions.map((review, index) => (
          <article className="card review-card" key={review.questionId}>
            <header className="review-card-header">
              <span className="card-title-row">
                <span className="question-number">Question {index + 1}</span>
                <span className={`type-chip type-${review.type}`}>
                  {QUESTION_LABELS[review.type]}
                </span>
                {review.warmup && <span className="pill">Warm-up · not counted</span>}
                {review.skipped && <span className="pill skipped">Skipped</span>}
                {review.timedOut && <span className="pill skipped">Out of time</span>}
              </span>
              <span>{Math.round(review.score * 10) / 10}%</span>
            </header>
            <ReviewTiming timing={review} />
            {review.type === "fill_blank" ? (
              <div className="review-question-copy">
                {review.segments.map((segment, segmentIndex) => {
                  if (segment.type === "text") {
                    return (
                      <span key={`${segmentIndex}-${segment.value}`}>
                        <MathText text={segment.value} />
                      </span>
                    );
                  }
                  const blank = review.blanks.find(
                    (candidate) => candidate.blankId === segment.blankId,
                  );
                  return (
                    <span className="review-blank" key={segment.blankId}>
                      <span className="review-answer-row">
                        <small>Your answer</small>
                        <strong>
                          {blank?.selectedAnswer ? (
                            <MathText text={blank.selectedAnswer} />
                          ) : review.skipped ? (
                            "Skipped"
                          ) : review.timedOut ? (
                            "Out of time"
                          ) : (
                            "No answer"
                          )}
                        </strong>
                      </span>
                      <span className="review-answer-row">
                        <small>Correct answer</small>
                        <strong>
                          {blank?.correctAnswer ? (
                            <MathText text={blank.correctAnswer} />
                          ) : (
                            "Unavailable"
                          )}
                        </strong>
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : review.type === "multiple_choice" ? (
              <div className="free-review">
                <h3>
                  <MathText text={review.prompt} />
                </h3>
                <div className="option-list review-option-list">
                  {review.options.map((option) => {
                    const isCorrect = option.id === review.correctOptionId;
                    const isSelected = option.id === review.selectedOptionId;
                    return (
                      <div
                        className={`option review-option ${isCorrect ? "correct" : ""} ${
                          isSelected && !isCorrect ? "incorrect" : ""
                        }`}
                        key={option.id}
                      >
                        <span>
                          <MathText text={option.label} />
                        </span>
                        <small>
                          {isCorrect && isSelected
                            ? "Correct answer · your answer"
                            : isCorrect
                              ? "Correct answer"
                              : isSelected
                                ? "Your answer"
                                : ""}
                        </small>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <span className="review-label">Why</span>
                  <p>
                    <MathText text={review.rationale} />
                  </p>
                </div>
              </div>
            ) : (
              <div className="free-review">
                <h3>
                  <MathText text={review.prompt} />
                </h3>
                <div>
                  <span className="review-label">Your response</span>
                  <p>
                    {review.skipped ? (
                      "Skipped — no response was submitted."
                    ) : review.timedOut ? (
                      "Not answered — the overall time limit ran out."
                    ) : (
                      <MathText text={review.response} />
                    )}
                  </p>
                </div>
                <div>
                  <span className="review-label">Rubric</span>
                  <p>
                    <MathText text={review.rubric.summary} />
                  </p>
                  <ul>
                    {review.rubric.criteria.map((criterion) => (
                      <li key={criterion.criterion}>
                        <strong>
                          <MathText text={criterion.criterion} /> ({criterion.points} points)
                        </strong>
                        <span>
                          <MathText text={criterion.guidance} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="review-label">Grading feedback</span>
                  <p>
                    <MathText text={review.feedback} />
                  </p>
                </div>
              </div>
            )}
            {examineeFeedback &&
              (examineeFeedback.showEmpty ||
                Boolean(examineeFeedback.commentsByQuestionId[review.questionId])) && (
              <div className="question-examinee-feedback">
                <label
                  className="review-label"
                  htmlFor={`examinee-feedback-${review.questionId}`}
                >
                  {examineeFeedback.label ?? "Your feedback on this question"}
                </label>
                <textarea
                  className="control"
                  id={`examinee-feedback-${review.questionId}`}
                  value={examineeFeedback.commentsByQuestionId[review.questionId] ?? ""}
                  maxLength={10_000}
                  readOnly={examineeFeedback.submitted}
                  disabled={examineeFeedback.loading}
                  placeholder={
                    examineeFeedback.loading
                      ? "Loading feedback…"
                      : examineeFeedback.submitted
                        ? "No comment was submitted for this question."
                        : "Optional feedback about this question or its grading"
                  }
                  onChange={(event) =>
                    examineeFeedback.onChange(review.questionId, event.target.value)
                  }
                />
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  );
}

function ExamineeFeedbackReview({ result }: { result: AssessmentResult }) {
  const [commentsByQuestionId, setCommentsByQuestionId] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/attempts/${encodeURIComponent(result.attemptId)}/feedback`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          submitted?: boolean;
          feedback?: { commentsByQuestionId?: Record<string, string> } | null;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load feedback.");
        if (active) {
          setSubmitted(payload.submitted === true);
          setCommentsByQuestionId(payload.feedback?.commentsByQuestionId ?? {});
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load feedback.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [result.attemptId]);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/attempts/${encodeURIComponent(result.attemptId)}/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentsByQuestionId }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        feedback?: { commentsByQuestionId?: Record<string, string> };
      };
      if (!response.ok) throw new Error(payload.error ?? "Unable to submit feedback.");
      setCommentsByQuestionId(payload.feedback?.commentsByQuestionId ?? {});
      setSubmitted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit feedback.");
    } finally {
      setSaving(false);
    }
  }

  const hasComment = Object.values(commentsByQuestionId).some((comment) => comment.trim());

  return (
    <>
      <ResultSections
        result={result}
        examineeFeedback={{
          commentsByQuestionId,
          submitted,
          loading,
          showEmpty: true,
          onChange: (questionId, comment) =>
            setCommentsByQuestionId((current) => ({ ...current, [questionId]: comment })),
        }}
      />
      <section className="card form-card feedback-submit-card">
        <p className="eyebrow">
          {submitted ? "Feedback submitted" : "Examinee feedback"}
        </p>
        <h2>
          {submitted ? "Thank you for your feedback." : "Share feedback with the assessor"}
        </h2>
        <p className="hint">
          {submitted
            ? "Your question comments are locked and cannot be changed."
            : "Each question comment is optional. Submit them together once when you are finished; they cannot be edited afterward."}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        {!submitted && (
          <button
            className="primary"
            type="button"
            disabled={loading || saving}
            onClick={() => void submit()}
          >
            {saving
              ? "Submitting…"
              : hasComment
                ? "Submit feedback"
                : "Submit without comments"}
          </button>
        )}
      </section>
    </>
  );
}

export function ResultView({
  result,
  collectFeedback = false,
  submittedFeedback = null,
  onBack,
}: {
  result: AssessmentResult;
  collectFeedback?: boolean;
  submittedFeedback?: ExamineeFeedback | null;
  onBack?: () => void;
}) {
  return (
    <PdfAssessmentSplit attemptId={result.attemptId} pdfLabel={result.paperName}>
      <main className="app-shell">
        {onBack && (
          <div className="result-navigation">
            <button className="secondary" type="button" onClick={onBack}>
              Back to dashboard
            </button>
          </div>
        )}
        {collectFeedback ? (
          <ExamineeFeedbackReview result={result} />
        ) : (
          <ResultSections
            result={result}
            examineeFeedback={
              submittedFeedback
                ? {
                    commentsByQuestionId: submittedFeedback.commentsByQuestionId,
                    submitted: true,
                    loading: false,
                    label: "Examinee feedback on this question",
                    onChange: () => undefined,
                  }
                : undefined
            }
          />
        )}
      </main>
    </PdfAssessmentSplit>
  );
}

export function PendingEvaluationView({
  attemptId,
  onResult,
  onBack,
}: {
  attemptId: string;
  onResult: (result: AssessmentResult) => void;
  onBack?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [keySource, setKeySource] = useState<KeySource>("paste");
  const [credentialRequired, setCredentialRequired] = useState(false);
  const [status, setStatus] = useState("Waiting for the evaluator…");
  const [error, setError] = useState("");
  const [submittingKey, setSubmittingKey] = useState(false);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const response = await fetch(
          `/api/attempts/${encodeURIComponent(attemptId)}/grading`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          status?: string;
          error?: string;
          gradingCredentialRequired?: boolean;
          result?: AssessmentResult;
        };
        if (!response.ok) throw new Error(payload.error ?? "Unable to check grading.");
        if (!active) return;
        if (payload.status === "completed" && payload.result) {
          onResult(payload.result);
          return;
        }
        setCredentialRequired(payload.gradingCredentialRequired === true);
        setStatus(
          payload.status === "running"
            ? "Grading your assessment…"
            : payload.status === "queued"
              ? "Your assessment is queued for grading…"
              : payload.status === "failed"
                ? "Grading was interrupted. Supply your key again to retry."
                : "Supply your OpenRouter key to grade this conference assessment.",
        );
        if (payload.status === "failed" && payload.error) setError(payload.error);
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to check grading.");
        }
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [attemptId, onResult]);

  async function submitGradingKey() {
    setSubmittingKey(true);
    setError("");
    try {
      const key =
        keySource === "oauth" ? (await validateBrowserOpenRouterKey()).key : apiKey.trim();
      if (!key) throw new Error("Enter or connect an OpenRouter API key.");
      const response = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey: key, keySource }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: AssessmentResult;
      };
      if (!response.ok) throw new Error(payload.error ?? "Unable to start grading.");
      if (keySource === "paste") setApiKey("");
      setCredentialRequired(false);
      setStatus("Your assessment is queued for grading…");
      if (payload.result) onResult(payload.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start grading.");
    } finally {
      setSubmittingKey(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="card result neutral-result">
        <p className="eyebrow">Assessment submitted</p>
        <h1>{credentialRequired ? "Submit your key to grade the assessment." : status}</h1>
        {credentialRequired && (
          <>
            <p className="lede">
              As with generation, your key is used for this grading job and is not saved by
              greCAPTCHA.
            </p>
            <OpenRouterKeyPanel
              apiKey={apiKey}
              source={keySource}
              onChange={(key, source) => {
                setApiKey(key);
                setKeySource(source);
              }}
            />
            <button
              className="primary"
              type="button"
              disabled={submittingKey}
              onClick={() => void submitGradingKey()}
            >
              {submittingKey ? "Starting grading…" : "Grade assessment"}
            </button>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {onBack && (
          <button className="primary" type="button" onClick={onBack}>
            Back to dashboard
          </button>
        )}
      </section>
    </main>
  );
}

export function QuizWorkspace({
  initialAttempt,
  collectFeedback = false,
  onBack,
}: {
  initialAttempt: AttemptView;
  collectFeedback?: boolean;
  onBack?: () => void;
}) {
  const [attempt, setAttempt] = useState(initialAttempt);
  const [draft, setDraft] = useState<DraftAnswer>(initialAttempt.draft);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [pendingEvaluation, setPendingEvaluation] = useState(false);
  const [overallElapsedMs, setOverallElapsedMs] = useState(initialAttempt.overallElapsedMs);
  const interactionReported = useRef(initialAttempt.firstInteractionRecorded);
  const timeoutFired = useRef(false);
  const autosaveTimer = useRef<number | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const savedDraft = useRef(
    JSON.stringify({ questionId: initialAttempt.question.id, answer: initialAttempt.draft }),
  );
  const question = attempt.question;
  const overallLimitMs =
    attempt.overallTimeLimitSeconds === null ? null : attempt.overallTimeLimitSeconds * 1000;
  const overallRemainingMs = overallLimitMs === null ? null : overallLimitMs - overallElapsedMs;
  // Bound rather than tested inline, so the limit and remainder reach the clock as numbers.
  const overallClock =
    attempt.overallTimeLimitSeconds !== null && overallRemainingMs !== null
      ? { limitSeconds: attempt.overallTimeLimitSeconds, remainingMs: overallRemainingMs }
      : null;

  // The overall clock resumes from the server's active-time total after refresh/navigation.
  useEffect(() => {
    const servedAt = Date.now();
    const overallBase = attempt.overallElapsedMs;
    setOverallElapsedMs(attempt.overallElapsedMs);
    interactionReported.current = attempt.firstInteractionRecorded;
    timeoutFired.current = false;
    if (attempt.overallTimeLimitSeconds === null) return;
    const ticker = window.setInterval(() => {
      setOverallElapsedMs(overallBase + Date.now() - servedAt);
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [attempt]);

  /**
   * Tells the server the participant has touched the answer for the first time. The
   * browser sends no timestamp — the server stamps its own clock and ignores repeats.
   */
  function reportFirstInteraction() {
    if (interactionReported.current) return;
    interactionReported.current = true;
    void fetch(`/api/attempts/${attempt.attemptId}/interaction`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // Telemetry only: a failed ping must never interrupt the attempt.
    });
  }

  function persistDraft(value: DraftAnswer = draft) {
    const body = { questionId: attempt.question.id, answer: value };
    const serialized = JSON.stringify(body);
    if (serialized === savedDraft.current) return saveChain.current;
    setSaveState("saving");
    const request = saveChain.current
      .catch(() => undefined)
      .then(async () => {
        if (serialized === savedDraft.current) return;
        const response = await fetch(`/api/attempts/${attempt.attemptId}/answers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to save your answer.");
        savedDraft.current = serialized;
        setSaveState("saved");
      })
      .catch((caught) => {
        setSaveState("error");
        setError(caught instanceof Error ? caught.message : "Unable to save your answer.");
        throw caught;
      });
    saveChain.current = request;
    return request;
  }

  useEffect(() => {
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void persistDraft().catch(() => undefined);
    }, 500);
    return () => {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    };
    // Persisting is intentionally keyed to the current editor value and question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, attempt.question.id]);

  function loadAttempt(next: AttemptView) {
    setAttempt(next);
    setDraft(next.draft);
    savedDraft.current = JSON.stringify({
      questionId: next.question.id,
      answer: next.draft,
    });
    setSaveState("saved");
  }

  async function goToQuestion(index: number) {
    if (index === attempt.currentIndex || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
      await persistDraft();
      const response = await fetch(`/api/attempts/${attempt.attemptId}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to open that question.");
      if (payload.pendingEvaluation) setPendingEvaluation(true);
      else if (payload.attempt) loadAttempt(payload.attempt as AttemptView);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open that question.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Fires once when the budget runs out. The current editor is flushed before the server locks
   * every draft, so the bell preserves work that has not reached the debounce yet.
   */
  useEffect(() => {
    if (overallRemainingMs === null || overallRemainingMs > 0) return;
    if (timeoutFired.current || submitting || result) return;
    timeoutFired.current = true;
    void closeOnTimeout();
    // closeOnTimeout is stable for this render and reads the current answer state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overallRemainingMs, submitting, result]);

  async function closeOnTimeout() {
    setSubmitting(true);
    setError("");
    try {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
      await persistDraft();
      const response = await fetch(`/api/attempts/${attempt.attemptId}/timeout`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to close the assessment.");
      if (payload.pendingEvaluation) {
        setPendingEvaluation(true);
      } else if (payload.attempt) {
        // The server disagreed that time was up; carry on from what it served.
        loadAttempt(payload.attempt as AttemptView);
        timeoutFired.current = false;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to close the assessment.");
    } finally {
      setSubmitting(false);
    }
  }

  const localAnswered = draftHasAnswer(draft);
  const answeredCount = attempt.questionProgress.filter((item, index) =>
    index === attempt.currentIndex ? localAnswered : item.answered,
  ).length;

  async function submitAssessment() {
    const unanswered = attempt.totalQuestions - answeredCount;
    const confirmation =
      unanswered > 0
        ? `${unanswered} ${
            unanswered === 1 ? "question is" : "questions are"
          } unanswered. Are you sure you want to submit? You cannot change your answers afterward.`
        : "Are you sure you want to submit this assessment? You cannot change your answers afterward.";
    if (!window.confirm(confirmation)) return;
    setSubmitting(true);
    setError("");
    try {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
      await persistDraft();
      const response = await fetch(`/api/attempts/${attempt.attemptId}/submit`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to submit assessment.");
      }
      setPendingEvaluation(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit assessment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return <ResultView result={result} collectFeedback={collectFeedback} onBack={onBack} />;
  }
  if (pendingEvaluation) {
    return (
      <PendingEvaluationView
        attemptId={attempt.attemptId}
        onResult={setResult}
        onBack={onBack}
      />
    );
  }

  return (
    <PdfAssessmentSplit attemptId={attempt.attemptId} pdfLabel={attempt.paperName}>
      <main className="app-shell">
      <header className="quiz-header sequential-header">
        <div>
          <h1>{attempt.paperName}</h1>
        </div>
        <div className="sequence-status attempt-status">
          {overallClock && (
            <OverallTimer
              elapsedMs={overallElapsedMs}
              remainingMs={overallClock.remainingMs}
              limitSeconds={overallClock.limitSeconds}
            />
          )}
          <div className="sequence-progress">
            Question {attempt.currentIndex + 1} of {attempt.totalQuestions}
          </div>
        </div>
      </header>

      <nav className="question-navigator" aria-label="Assessment questions">
        <div className="question-navigator-heading">
          <strong>All questions</strong>
          <span>
            {answeredCount} of {attempt.totalQuestions} answered
          </span>
        </div>
        <div className="question-navigator-grid">
          {attempt.questionProgress.map((item, index) => {
            const answered = index === attempt.currentIndex ? localAnswered : item.answered;
            const current = index === attempt.currentIndex;
            return (
              <button
                key={item.position}
                type="button"
                className={`question-nav-item ${answered ? "answered" : "unanswered"} ${
                  current ? "current" : ""
                }`}
                aria-current={current ? "step" : undefined}
                aria-label={`Question ${item.position}, ${answered ? "answered" : "unanswered"}${
                  current ? ", current question" : ""
                }`}
                disabled={submitting}
                onClick={() => void goToQuestion(index)}
              >
                {item.position}
              </button>
            );
          })}
        </div>
      </nav>

      {/*
        No type chip: naming the format tells the participant nothing the question itself does not
        already show, and the label is researcher-side categorisation. It stays on the review, the
        plan page and the set overview, which are researcher-facing.
      */}
      <section className="card question-card">
        {question.type === "fill_blank" ? (
          <FillQuestionEditor
            question={question}
            selections={draft.type === "fill_blank" ? draft.selections : {}}
            onChange={(next) => {
              reportFirstInteraction();
              setDraft({ type: "fill_blank", selections: next });
            }}
          />
        ) : question.type === "multiple_choice" ? (
          <MultipleChoiceQuestion
            question={question}
            selectedOptionId={draft.type === "multiple_choice" ? draft.optionId : null}
            onSelect={(optionId) => {
              reportFirstInteraction();
              setDraft({ type: "multiple_choice", optionId });
            }}
          />
        ) : (
          <div className="free-response-question">
            <h2>
              <MathText text={question.prompt} />
            </h2>
            <label htmlFor="freeResponse">Your response</label>
            <textarea
              className="control"
              id="freeResponse"
              value={draft.type === "free_response" ? draft.response : ""}
              onChange={(event) => {
                reportFirstInteraction();
                setDraft({ type: "free_response", response: event.target.value });
              }}
              placeholder="Write your answer here..."
              maxLength={50_000}
            />
          </div>
        )}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="autosave-status" role="status" aria-live="polite">
        {saveState === "saving"
          ? "Saving…"
          : saveState === "error"
            ? "Save failed"
            : "All changes saved"}
      </div>
      <div className="quiz-actions navigable-actions">
        <button
          className="secondary"
          type="button"
          disabled={submitting || attempt.currentIndex === 0}
          onClick={() => void goToQuestion(attempt.currentIndex - 1)}
        >
          Previous
        </button>
        <button
          className="secondary"
          type="button"
          disabled={submitting || attempt.currentIndex === attempt.totalQuestions - 1}
          onClick={() => void goToQuestion(attempt.currentIndex + 1)}
        >
          Next
        </button>
        <button
          className="primary submit-assessment"
          type="button"
          disabled={submitting}
          onClick={() => void submitAssessment()}
        >
          {submitting ? "Working…" : "Submit assessment"}
        </button>
      </div>
      </main>
    </PdfAssessmentSplit>
  );
}
