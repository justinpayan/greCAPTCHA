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
import { CSSProperties, useMemo, useState } from "react";

import type {
  AssessmentResult,
  AttemptView,
  PublicFillQuestion,
  QuizChoice,
} from "@/lib/quiz";

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
      aria-pressed={selected}
      {...listeners}
      {...attributes}
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

function SetIdBadge({ id }: { id: string }) {
  return (
    <div className="set-id-badge" title="Reusable question-set row ID">
      Question set <code>{id}</code>
    </div>
  );
}

function formatDuration(durationMs: number) {
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function QuizWorkspace({ initialAttempt }: { initialAttempt: AttemptView }) {
  const [attempt, setAttempt] = useState(initialAttempt);
  const [fillSelections, setFillSelections] = useState<FillSelections>({});
  const [freeResponse, setFreeResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const question = attempt.question;

  const answerComplete =
    question.type === "fill_blank"
      ? question.blankIds.every((blankId) => fillSelections[blankId])
      : freeResponse.trim().length > 0;

  async function submitCurrentAnswer() {
    if (!answerComplete) return;
    setSubmitting(true);
    setError("");
    try {
      const answer =
        question.type === "fill_blank"
          ? { type: "fill_blank", selections: fillSelections }
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
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit answer.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
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
            Scores are shown as an equal-weight average across all questions.
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
                <span className="question-number">Question {index + 1}</span>
                <span>
                  {Math.round(review.score * 10) / 10}% ·{" "}
                  {formatDuration(review.durationMs)}
                </span>
              </header>
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
        <SetIdBadge id={result.questionSetId} />
      </main>
    );
  }

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
        <div className="sequence-progress">
          Question {attempt.currentIndex + 1} of {attempt.totalQuestions}
        </div>
      </header>

      <section className="card question-card">
        <span className="question-number">
          {question.type === "fill_blank" ? "Fill in the blank" : "Free response"}
        </span>
        {question.type === "fill_blank" ? (
          <FillQuestionEditor
            question={question}
            selections={fillSelections}
            onChange={setFillSelections}
          />
        ) : (
          <div className="free-response-question">
            <h2>{question.prompt}</h2>
            <label htmlFor="freeResponse">Your response</label>
            <textarea
              className="control"
              id="freeResponse"
              value={freeResponse}
              onChange={(event) => setFreeResponse(event.target.value)}
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
      <SetIdBadge id={attempt.questionSetId} />
    </main>
  );
}
