"use client";

import { Fragment } from "react";

import { MathText } from "@/components/quiz/math-text";
import { paginateForPrint } from "@/lib/print-layout";
import type { QuestionSetOverview, QuestionSetOverviewItem, StoredQuestion } from "@/lib/quiz";

const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function formatLimit(seconds: number | null) {
  if (seconds === null) return "No time limit";
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Blank numbers in the order they appear in the sentence, so the key can refer to them. */
function blankNumbers(question: Extract<StoredQuestion, { type: "fill_blank" }>) {
  const numbers = new Map<string, number>();
  for (const segment of question.segments) {
    if (segment.type === "blank" && !numbers.has(segment.blankId)) {
      numbers.set(segment.blankId, numbers.size + 1);
    }
  }
  return numbers;
}

function PrintedQuestion({
  item,
  withKey,
}: {
  item: QuestionSetOverviewItem;
  withKey: boolean;
}) {
  const { question } = item;
  return (
    <article className={`print-question print-${question.type}`}>
      <header className="print-question-head">
        <strong>Question {item.position}</strong>
        {item.warmup && <span>Warm-up · not scored</span>}
      </header>

      {question.type === "multiple_choice" && (
        <>
          <p className="print-prompt">
            <MathText text={question.prompt} />
          </p>
          <ol className="print-options">
            {question.options.map((option, index) => (
              <li
                key={option.id}
                className={withKey && option.id === question.correctOptionId ? "correct" : ""}
              >
                <span className="print-option-mark" aria-hidden="true" />
                <span className="print-option-letter">{OPTION_LETTERS[index] ?? index + 1}.</span>
                <span>
                  <MathText text={option.label} />
                </span>
              </li>
            ))}
          </ol>
          {withKey && (
            <div className="print-key">
              <strong>
                Answer:{" "}
                {OPTION_LETTERS[
                  question.options.findIndex((option) => option.id === question.correctOptionId)
                ] ?? "?"}
              </strong>{" "}
              <MathText text={question.rationale} />
            </div>
          )}
        </>
      )}

      {question.type === "fill_blank" && <PrintedFill question={question} withKey={withKey} />}

      {question.type === "free_response" && (
        <>
          <p className="print-prompt">
            <MathText text={question.prompt} />
          </p>
          {withKey ? (
            <div className="print-key">
              <strong>Rubric.</strong> <MathText text={question.rubric.summary} />
              <ul>
                {question.rubric.criteria.map((criterion) => (
                  <li key={criterion.criterion}>
                    <strong>
                      <MathText text={criterion.criterion} /> ({criterion.points} points).
                    </strong>{" "}
                    <MathText text={criterion.guidance} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="print-answer-space" aria-hidden="true" />
          )}
        </>
      )}
    </article>
  );
}

function PrintedFill({
  question,
  withKey,
}: {
  question: Extract<StoredQuestion, { type: "fill_blank" }>;
  withKey: boolean;
}) {
  const numbers = blankNumbers(question);
  const answers = new Map(question.blanks.map((blank) => [blank.id, blank.answer]));
  // Lettered so a taker writes a letter on each answer line rather than copying the phrase.
  const letterFor = new Map(
    question.choices.map((choice, index) => [choice.id, OPTION_LETTERS[index] ?? String(index + 1)]),
  );
  const answerLetter = new Map(
    question.blanks.map((blank) => [blank.id, letterFor.get(blank.correctChoiceId) ?? "?"]),
  );
  return (
    <>
      <p className="print-prompt print-fill-text">
        {question.segments.map((segment, index) =>
          segment.type === "text" ? (
            <MathText key={index} text={segment.value} />
          ) : (
            <span className="print-blank" key={index}>
              ({numbers.get(segment.blankId)})
            </span>
          ),
        )}
      </p>
      <div className="print-word-bank">
        <span className="print-word-bank-label">Word bank</span>
        <ul>
          {question.choices.map((choice) => (
            <li key={choice.id}>
              <span className="print-option-letter">{letterFor.get(choice.id)}.</span>{" "}
              <MathText text={choice.label} />
            </li>
          ))}
        </ul>
      </div>
      {withKey ? (
        <div className="print-key">
          <strong>Answers.</strong>{" "}
          {[...numbers.entries()].map(([blankId, number], index) => (
            <Fragment key={blankId}>
              {index > 0 && "; "}({number}) <strong>{answerLetter.get(blankId)}</strong>,{" "}
              <MathText text={answers.get(blankId) ?? "?"} />
            </Fragment>
          ))}
        </div>
      ) : (
        <ol className="print-blank-answers">
          {[...numbers.values()].map((number) => (
            <li key={number}>
              <span>({number})</span>
              <span className="print-answer-line" aria-hidden="true" />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * The question set laid out for paper: shown only when printing (`@media print`), hidden on
 * screen. Multiple-choice questions flow several to a page; any other question shares its page
 * with at most one other, and free responses get the page's spare height as writing space. With
 * `withKey`, each question also shows its answer, rationale, or rubric, for marking.
 */
export function PrintableQuestionSet({
  overview,
  title,
  withKey,
}: {
  overview: QuestionSetOverview;
  title: string;
  withKey: boolean;
}) {
  const pages = paginateForPrint(overview.items);
  return (
    <div className={`print-sheet${withKey ? " print-with-key" : ""}`}>
      {pages.map((page, index) => (
        <section className={`print-page print-page-${page.kind}`} key={index}>
          {index === 0 && (
            <header className="print-cover">
              <div>
                <p className="print-eyebrow">{withKey ? "Answer key" : "greCAPTCHA assessment"}</p>
                <h1>{title}</h1>
                <p className="print-meta">
                  {overview.items.length} question{overview.items.length === 1 ? "" : "s"} ·{" "}
                  {formatLimit(overview.overallTimeLimitSeconds)}
                </p>
              </div>
              {!withKey && (
                <div className="print-taker">
                  <span>
                    Name <span className="print-answer-line" aria-hidden="true" />
                  </span>
                  <span>
                    Date <span className="print-answer-line" aria-hidden="true" />
                  </span>
                </div>
              )}
            </header>
          )}
          {page.items.map((item) => (
            <PrintedQuestion key={item.questionId} item={item} withKey={withKey} />
          ))}
        </section>
      ))}
    </div>
  );
}
