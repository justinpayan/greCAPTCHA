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

import type { PublicQuestion, PublicQuiz, QuizChoice } from "@/lib/quiz";

type AnswerMap = Record<string, string | null>;
type GradeResult = {
  score: number;
  percentage: number;
  passed: boolean;
  correct: number;
  total: number;
  threshold: number;
  feedback: Array<{
    questionNumber: number;
    correct: boolean;
    blanks: Array<{
      blankId: string;
      selectedAnswer: string | null;
      correctAnswer: string;
      correct: boolean;
    }>;
  }>;
};

function answerKey(question: PublicQuestion, blankId: string) {
  return `${question.id}:${blankId}`;
}

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
    opacity: isDragging ? 0.55 : undefined,
    position: "relative",
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      className={`choice ${selected ? "selected" : ""}`}
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
      aria-label={label ? `Blank filled with ${label}. Click to clear.` : "Empty answer blank"}
    >
      {label ?? "Drop answer"}
    </button>
  );
}

function WordBank({
  question,
  answers,
  onChoose,
}: {
  question: PublicQuestion;
  answers: AnswerMap;
  onChoose: (choiceId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: "word-bank" });
  const usedChoices = new Set(
    question.blankIds.map((blankId) => answers[answerKey(question, blankId)]).filter(Boolean),
  );
  return (
    <div ref={setNodeRef} className={`word-bank ${isOver ? "drag-over" : ""}`}>
      <span className="word-bank-label">Word bank · drag or select an answer</span>
      <div className="choices">
        {question.choices.map((choice) => (
          <DraggableChoice
            key={choice.id}
            choice={choice}
            selected={usedChoices.has(choice.id)}
            onChoose={() => onChoose(choice.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function QuizWorkspace({ quiz }: { quiz: PublicQuiz }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GradeResult | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const question = quiz.questions[currentIndex];

  const choiceLabels = useMemo(
    () => new Map(question.choices.map((choice) => [choice.id, choice.label])),
    [question],
  );

  function setBlank(blankId: string, choiceId: string | null) {
    setAnswers((current) => {
      const next = { ...current };
      for (const candidateBlankId of question.blankIds) {
        const key = answerKey(question, candidateBlankId);
        if (choiceId && next[key] === choiceId) next[key] = null;
      }
      next[answerKey(question, blankId)] = choiceId;
      return next;
    });
  }

  function chooseFirstAvailableBlank(choiceId: string) {
    const currentlyUsedIn = question.blankIds.find(
      (blankId) => answers[answerKey(question, blankId)] === choiceId,
    );
    if (currentlyUsedIn) {
      setBlank(currentlyUsedIn, null);
      return;
    }
    const blankId =
      question.blankIds.find((candidate) => !answers[answerKey(question, candidate)]) ??
      question.blankIds[0];
    if (blankId) setBlank(blankId, choiceId);
  }

  function handleDragEnd(event: DragEndEvent) {
    const choiceId = String(event.active.id);
    const destination = event.over?.id ? String(event.over.id) : "";
    if (destination.startsWith("blank:")) {
      setBlank(destination.slice("blank:".length), choiceId);
    } else if (destination === "word-bank") {
      const existingBlank = question.blankIds.find(
        (blankId) => answers[answerKey(question, blankId)] === choiceId,
      );
      if (existingBlank) setBlank(existingBlank, null);
    }
  }

  function isQuestionAnswered(candidate: PublicQuestion) {
    return candidate.blankIds.every((blankId) => answers[answerKey(candidate, blankId)]);
  }

  async function submitAnswers() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to grade answers.");
      setResult(payload.result as GradeResult);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to grade answers.");
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
        <section className="card result">
          <p className="eyebrow">Assessment complete</p>
          <h1 className={result.passed ? "pass" : "fail"}>
            {result.passed ? "You passed." : "Not quite."}
          </h1>
          <div className="score-ring">{result.percentage}%</div>
          <p className="lede" style={{ marginInline: "auto" }}>
            You answered {result.correct} of {result.total} blanks correctly.
            The passing threshold is {result.threshold}%.
          </p>
        </section>

        <section className="review-section" aria-labelledby="answer-review-heading">
          <div className="review-heading">
            <div>
              <p className="eyebrow">Read-only review</p>
              <h2 id="answer-review-heading">Compare your answers</h2>
            </div>
            <p>Answers are locked after submission.</p>
          </div>

          {result.feedback.map((item, questionIndex) => {
            const reviewQuestion = quiz.questions[questionIndex];
            const feedbackByBlank = new Map(
              item.blanks.map((blank) => [blank.blankId, blank]),
            );

            return (
              <article className="card review-card" key={item.questionNumber}>
                <header className="review-card-header">
                  <span className="question-number">Question {item.questionNumber}</span>
                  <span className={item.correct ? "pass" : "fail"}>
                    {item.blanks.filter((blank) => blank.correct).length}/{item.blanks.length}{" "}
                    blanks correct
                  </span>
                </header>
                <div className="review-question-copy">
                  {reviewQuestion.segments.map((segment, segmentIndex) => {
                    if (segment.type === "text") {
                      return (
                        <span key={`${segmentIndex}-${segment.value}`}>{segment.value}</span>
                      );
                    }

                    const blank = feedbackByBlank.get(segment.blankId);
                    return (
                      <span
                        className={`review-blank ${blank?.correct ? "correct" : "incorrect"}`}
                        key={segment.blankId}
                      >
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
              </article>
            );
          })}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>

      <header className="quiz-header">
        <div>
          <p className="eyebrow">Understanding assessment</p>
          <h1>{quiz.paperName}</h1>
          <div className="quiz-meta">
            {quiz.modelId} · {quiz.pdfEngine}
          </div>
        </div>
        <nav className="progress-grid" aria-label="Questions">
          {quiz.questions.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              className={`progress-dot ${isQuestionAnswered(candidate) ? "answered" : ""} ${
                index === currentIndex ? "current" : ""
              }`}
              onClick={() => setCurrentIndex(index)}
              aria-label={`Go to question ${index + 1}`}
            >
              {index + 1}
            </button>
          ))}
        </nav>
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <section className="card question-card">
          <span className="question-number">
            Question {currentIndex + 1} of {quiz.questions.length}
          </span>
          <div className="question-copy">
            {question.segments.map((segment, index) =>
              segment.type === "text" ? (
                <span key={`${index}-${segment.value}`}>{segment.value}</span>
              ) : (
                <BlankSlot
                  key={segment.blankId}
                  id={segment.blankId}
                  label={
                    choiceLabels.get(answers[answerKey(question, segment.blankId)] ?? "") ??
                    undefined
                  }
                  onClear={() => setBlank(segment.blankId, null)}
                />
              ),
            )}
          </div>
          <WordBank
            question={question}
            answers={answers}
            onChoose={chooseFirstAvailableBlank}
          />
        </section>
      </DndContext>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="quiz-actions">
        <button
          className="secondary"
          type="button"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((index) => index - 1)}
        >
          Previous
        </button>
        {currentIndex === quiz.questions.length - 1 ? (
          <button
            className="primary"
            type="button"
            onClick={submitAnswers}
            disabled={submitting}
          >
            {submitting ? "Grading…" : "Submit answers and grade me"}
          </button>
        ) : (
          <button
            className="primary"
            type="button"
            onClick={() => setCurrentIndex((index) => index + 1)}
          >
            Next question
          </button>
        )}
      </div>
    </main>
  );
}
