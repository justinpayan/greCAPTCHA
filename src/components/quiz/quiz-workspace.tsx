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
      {choice.label}
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
      {label ?? "Drop answer"}
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
            <span key={`${index}-${segment.value}`}>{segment.value}</span>
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
      <h2>{question.prompt}</h2>
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
            {option.label}
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

function ReviewTiming({ timing }: { timing: QuestionTiming }) {
  const parts = [`Answered in ${formatDuration(timing.durationMs)}`];
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

/** Read-only review of a graded attempt. Rendered on its own once grading has run. */
export function ResultView({ result }: { result: AssessmentResult }) {
  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>
      <section className="card result neutral-result">
        <p className="eyebrow">Assessment complete</p>
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
              </span>
              <span>{Math.round(review.score * 10) / 10}%</span>
            </header>
            <ReviewTiming timing={review} />
            {review.type === "fill_blank" ? (
              <div className="review-question-copy">
                {review.segments.map((segment, segmentIndex) => {
                  if (segment.type === "text") {
                    return <span key={`${segmentIndex}-${segment.value}`}>{segment.value}</span>;
                  }
                  const blank = review.blanks.find(
                    (candidate) => candidate.blankId === segment.blankId,
                  );
                  return (
                    <span className="review-blank" key={segment.blankId}>
                      <span className="review-answer-row">
                        <small>Your answer</small>
                        <strong>{blank?.selectedAnswer ?? "No answer"}</strong>
                      </span>
                      <span className="review-answer-row">
                        <small>Correct answer</small>
                        <strong>{blank?.correctAnswer ?? "Unavailable"}</strong>
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : review.type === "multiple_choice" ? (
              <div className="free-review">
                <h3>{review.prompt}</h3>
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
                        <span>{option.label}</span>
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
                  <p>{review.rationale}</p>
                </div>
              </div>
            ) : (
              <div className="free-review">
                <h3>{review.prompt}</h3>
                <div>
                  <span className="review-label">Your response</span>
                  <p>{review.response}</p>
                </div>
                <div>
                  <span className="review-label">Rubric</span>
                  <p>{review.rubric.summary}</p>
                  <ul>
                    {review.rubric.criteria.map((criterion) => (
                      <li key={criterion.criterion}>
                        <strong>
                          {criterion.criterion} ({criterion.points} points)
                        </strong>
                        <span>{criterion.guidance}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="review-label">Grading feedback</span>
                  <p>{review.feedback}</p>
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}

export function QuizWorkspace({ initialAttempt }: { initialAttempt: AttemptView }) {
  const [attempt, setAttempt] = useState(initialAttempt);
  const [fillSelections, setFillSelections] = useState<FillSelections>({});
  const [freeResponse, setFreeResponse] = useState("");
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState(initialAttempt.elapsedMs);
  const interactionReported = useRef(initialAttempt.firstInteractionRecorded);
  const question = attempt.question;

  // The server tells us how long this question has already been open, so the display
  // resumes correctly after a refresh instead of restarting at zero.
  useEffect(() => {
    const servedAt = Date.now() - attempt.elapsedMs;
    setElapsedMs(attempt.elapsedMs);
    interactionReported.current = attempt.firstInteractionRecorded;
    // Nothing renders the clock when it is hidden, so do not re-render once a second.
    if (attempt.countdownHidden) return;
    const ticker = window.setInterval(() => setElapsedMs(Date.now() - servedAt), 1000);
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

  const answerComplete =
    question.type === "fill_blank"
      ? question.blankIds.every((blankId) => fillSelections[blankId])
      : question.type === "multiple_choice"
        ? selectedOptionId !== null
        : freeResponse.trim().length > 0;

  async function submitCurrentAnswer() {
    if (!answerComplete) return;
    setSubmitting(true);
    setError("");
    try {
      const answer =
        question.type === "fill_blank"
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
      if (!response.ok) throw new Error(payload.error ?? "Unable to submit answer.");
      if (payload.result) {
        setResult(payload.result as AssessmentResult);
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
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>
      <header className="quiz-header sequential-header">
        <div>
          <p className="eyebrow">Understanding assessment</p>
          <h1>{attempt.paperName}</h1>
          <div className="quiz-meta">{attempt.modelId}</div>
        </div>
        <div className="sequence-status">
          <div className="sequence-progress">
            Question {attempt.currentIndex + 1} of {attempt.totalQuestions}
          </div>
          {/* Display only: hiding this changes nothing about what the server records. */}
          {!attempt.countdownHidden && (
            <QuestionTimer
              elapsedMs={elapsedMs}
              timeLimitSeconds={question.timeLimitSeconds ?? null}
            />
          )}
        </div>
      </header>

      <section className="card question-card">
        <span className={`type-chip type-${question.type}`}>
          {QUESTION_LABELS[question.type]}
        </span>
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
            <h2>{question.prompt}</h2>
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
        <button
          className="primary"
          type="button"
          disabled={!answerComplete || submitting}
          onClick={submitCurrentAnswer}
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
