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
import type {
  AssessmentResult,
  AttemptView,
  PublicFillQuestion,
  PublicMultipleChoiceQuestion,
  QuestionTiming,
  QuizChoice,
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
 * Soft countdown. It reports the remaining time against the question's limit and keeps
 * counting once that limit passes; nothing about the attempt changes when it does. The
 * authoritative duration is measured on the server, so this display is informational.
 */
function QuestionTimer({
  elapsedMs,
  timeLimitSeconds,
}: {
  elapsedMs: number;
  timeLimitSeconds: number | null;
}) {
  if (timeLimitSeconds === null) {
    return <div className="question-timer">{formatClock(elapsedMs)} elapsed</div>;
  }
  const remainingMs = timeLimitSeconds * 1000 - elapsedMs;
  const over = remainingMs < 0;
  return (
    <div className={`question-timer ${over ? "over" : ""}`}>
      {over
        ? `${formatClock(-remainingMs)} over ${formatDuration(timeLimitSeconds * 1000)}`
        : `${formatClock(remainingMs)} left of ${formatDuration(timeLimitSeconds * 1000)}`}
    </div>
  );
}

/**
 * Both clocks for the whole set: how long has been spent and how much is left.
 *
 * Only shown when a set carries an overall limit, since without one there is no remainder to
 * report. Unlike the per-question timer this budget is enforced, so reaching zero asks the server
 * to close the attempt — the server checks the budget itself and is free to disagree.
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
  if (timing.timeLimitSeconds !== null) {
    parts.push(
      timing.overrunMs
        ? `${formatDuration(timing.overrunMs)} over the ${formatDuration(timing.timeLimitSeconds * 1000)} soft limit`
        : `within the ${formatDuration(timing.timeLimitSeconds * 1000)} soft limit`,
    );
  }
  return <p className="review-timing">{parts.join(" · ")}</p>;
}

/**
 * Score card plus the full answer review for one attempt, without a page around it.
 *
 * Separate from `ResultView` so a chained experiment run can stack both blocks' reviews on a
 * single reveal page instead of showing one and hiding the other.
 */
export function ResultSections({
  result,
  label,
}: {
  result: AssessmentResult;
  /** Names the block when more than one review is on the page. */
  label?: string;
}) {
  return (
    <>
      <section className="card result neutral-result">
        <p className="eyebrow">{label ?? "Assessment complete"}</p>
        <h1>Overall score</h1>
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
          </article>
        ))}
      </section>
    </>
  );
}

/** Read-only review of one graded attempt, as its own page. */
export function ResultView({ result }: { result: AssessmentResult }) {
  return (
    <main className="app-shell">
      <ResultSections result={result} />
    </main>
  );
}

export function QuizWorkspace({
  initialAttempt,
  onFinish,
}: {
  initialAttempt: AttemptView;
  /**
   * Takes the graded result instead of this component showing it. A chained experiment run uses
   * this to move straight into the next paper: the participant must not see a score, or an
   * answer key, while a scored block is still ahead of them.
   *
   * Callers that swap in a new attempt afterwards must remount this component (key it by
   * attempt ID) — the question, timer and answer state all initialise from props.
   */
  onFinish?: (result: AssessmentResult) => void;
}) {
  const [attempt, setAttempt] = useState(initialAttempt);
  const [fillSelections, setFillSelections] = useState<FillSelections>({});
  const [freeResponse, setFreeResponse] = useState("");
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState(initialAttempt.elapsedMs);
  const [overallElapsedMs, setOverallElapsedMs] = useState(initialAttempt.overallElapsedMs);
  const interactionReported = useRef(initialAttempt.firstInteractionRecorded);
  const timeoutFired = useRef(false);
  const question = attempt.question;
  const overallLimitMs =
    attempt.overallTimeLimitSeconds === null ? null : attempt.overallTimeLimitSeconds * 1000;
  const overallRemainingMs = overallLimitMs === null ? null : overallLimitMs - overallElapsedMs;
  // Bound rather than tested inline, so the limit and remainder reach the clock as numbers.
  const overallClock =
    attempt.overallTimeLimitSeconds !== null && overallRemainingMs !== null
      ? { limitSeconds: attempt.overallTimeLimitSeconds, remainingMs: overallRemainingMs }
      : null;
  const showClocks = overallClock !== null || !attempt.countdownHidden;

  // The server tells us how long this question has already been open, so the display
  // resumes correctly after a refresh instead of restarting at zero.
  useEffect(() => {
    const servedAt = Date.now() - attempt.elapsedMs;
    const overallBase = attempt.overallElapsedMs - attempt.elapsedMs;
    setElapsedMs(attempt.elapsedMs);
    setOverallElapsedMs(attempt.overallElapsedMs);
    interactionReported.current = attempt.firstInteractionRecorded;
    timeoutFired.current = false;
    // The overall limit is enforced, so its clock has to run even when the display is hidden —
    // otherwise hiding the countdown would quietly disable the limit.
    if (attempt.countdownHidden && attempt.overallTimeLimitSeconds === null) return;
    const ticker = window.setInterval(() => {
      const onThisQuestion = Date.now() - servedAt;
      setElapsedMs(onThisQuestion);
      setOverallElapsedMs(overallBase + onThisQuestion);
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

  /**
   * Fires once when the budget runs out. An answer already entered is submitted first, so the bell
   * does not discard work; otherwise the server is asked to close the attempt. Guarded by a ref so
   * a slow round trip cannot fire it twice.
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
    if (answerComplete) {
      await submitCurrentAnswer();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/attempts/${attempt.attemptId}/timeout`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to close the assessment.");
      if (payload.result) {
        const graded = payload.result as AssessmentResult;
        if (onFinish) onFinish(graded);
        else setResult(graded);
      } else if (payload.attempt) {
        // The server disagreed that time was up; carry on from what it served.
        setAttempt(payload.attempt as AttemptView);
        timeoutFired.current = false;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to close the assessment.");
    } finally {
      setSubmitting(false);
    }
  }

  const answerComplete =
    question.type === "fill_blank"
      ? question.blankIds.every((blankId) => fillSelections[blankId])
      : question.type === "multiple_choice"
        ? selectedOptionId !== null
        : freeResponse.trim().length > 0;

  /**
   * Sends the current answer, or a skip. Both lock the question and advance, so they share one
   * path: the only difference is the payload and that a skip needs no completed answer.
   */
  async function submitCurrentAnswer(skip = false) {
    if (!skip && !answerComplete) return;
    setSubmitting(true);
    setError("");
    try {
      const answer = skip
        ? { type: "skip" }
        : question.type === "fill_blank"
          ? { type: "fill_blank", selections: fillSelections }
          : question.type === "multiple_choice"
            ? { type: "multiple_choice", optionId: selectedOptionId }
            : { type: "free_response", response: freeResponse };
      const response = await fetch(`/api/attempts/${attempt.attemptId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answer),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? (skip ? "Unable to skip." : "Unable to submit answer."));
      }
      if (payload.result) {
        const graded = payload.result as AssessmentResult;
        if (onFinish) onFinish(graded);
        else setResult(graded);
      } else {
        setAttempt(payload.attempt as AttemptView);
        setFillSelections({});
        setFreeResponse("");
        setSelectedOptionId(null);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit answer.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <ResultView result={result} />;

  return (
    <main className="app-shell">
      <header className="quiz-header sequential-header">
        <div>
          {/* Server-chosen label: the real filename for a standalone attempt, "Paper 1"
              or "Paper 2" inside an experiment, where a filename could reveal which
              paper is the participant's own. */}
          <h1>{attempt.paperName}</h1>
        </div>
        <div className="sequence-status attempt-status">
          {/* The clocks sit to the left of the question count, stacked among themselves. */}
          {showClocks && (
            <div className="attempt-clocks">
              {/* Display only: hiding this changes nothing about what the server records. */}
              {!attempt.countdownHidden && (
                <QuestionTimer
                  elapsedMs={elapsedMs}
                  timeLimitSeconds={question.timeLimitSeconds ?? null}
                />
              )}
              {/*
                Shown even when the countdown is hidden. Hiding the per-question timer keeps time
                from being salient on an item whose limit is soft and costs nothing; the overall
                limit ends the assessment. Cutting someone off with no clock on screen is a
                different thing entirely, and not one this study should do to a participant.
              */}
              {overallClock && (
                <OverallTimer
                  elapsedMs={overallElapsedMs}
                  remainingMs={overallClock.remainingMs}
                  limitSeconds={overallClock.limitSeconds}
                />
              )}
            </div>
          )}
          <div className="sequence-progress">
            Question {attempt.currentIndex + 1} of {attempt.totalQuestions}
          </div>
        </div>
      </header>

      {/*
        No type chip: naming the format tells the participant nothing the question itself does not
        already show, and the label is researcher-side categorisation. It stays on the review, the
        plan page and the set overview, which are researcher-facing.
      */}
      <section className="card question-card">
        {question.type === "fill_blank" ? (
          <FillQuestionEditor
            question={question}
            selections={fillSelections}
            onChange={(next) => {
              reportFirstInteraction();
              setFillSelections(next);
            }}
          />
        ) : question.type === "multiple_choice" ? (
          <MultipleChoiceQuestion
            question={question}
            selectedOptionId={selectedOptionId}
            onSelect={(optionId) => {
              reportFirstInteraction();
              setSelectedOptionId(optionId);
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
              value={freeResponse}
              onChange={(event) => {
                reportFirstInteraction();
                setFreeResponse(event.target.value);
              }}
              placeholder="Write your answer here..."
              maxLength={50_000}
            />
          </div>
        )}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="quiz-actions sequential-actions">
        <span className="hint">Submitting locks this answer permanently.</span>
        {/* A button element for keyboard and screen-reader behaviour, but deliberately styled
            as plain text: skipping should be available without inviting itself. */}
        <button
          className="skip-link"
          type="button"
          disabled={submitting}
          onClick={() => void submitCurrentAnswer(true)}
        >
          Skip
        </button>
        <button
          className="primary"
          type="button"
          disabled={!answerComplete || submitting}
          onClick={() => void submitCurrentAnswer()}
        >
          {submitting
            ? attempt.currentIndex === attempt.totalQuestions - 1
              ? "Grading assessment…"
              : "Saving answer…"
            : attempt.currentIndex === attempt.totalQuestions - 1
              ? "Submit final answer and score"
              : "Submit answer and continue"}
        </button>
      </div>
    </main>
  );
}
