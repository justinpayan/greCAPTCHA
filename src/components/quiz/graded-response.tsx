"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { MathText } from "@/components/quiz/math-text";
import { segmentByEvidence } from "@/lib/evidence";
import type { FreeResponseReview } from "@/lib/quiz";

/** Criteria cycle through these, so a criterion's underline matches its badge in the rubric. */
const CRITERION_COLOURS = 6;

/**
 * A criterion's name without a numbering prefix of its own ("1. ", "2) ", "(3) ", "a. "). Some
 * generated rubrics number their criteria and some do not; here the number is always shown
 * separately, so a name that carries one would read "1. 1. …".
 */
function criterionName(name: string) {
  return name.replace(/^\s*(?:\(?\d{1,2}[.):]|\(?[a-z][.)])\s+/i, "");
}

function formatPoints(points: number) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/**
 * A graded free response: the response with the passages each rubric criterion was marked on
 * underlined, and the rubric with the points each criterion awarded and why.
 *
 * Hovering or focusing an underlined passage names its criteria in a tooltip and highlights them
 * in the rubric; hovering a criterion highlights its passages in the response. Responses graded
 * before per-criterion marks existed (and skipped ones) have no `criterionGrades` and render as
 * the plain response and rubric.
 */
/** The line box of a (possibly wrapped) passage nearest the pointer, to anchor the tooltip on. */
function anchorRect(element: HTMLElement, clientY?: number): DOMRect {
  const rects = [...element.getClientRects()];
  if (rects.length === 0) return element.getBoundingClientRect();
  if (clientY === undefined) return rects[0];
  return rects.reduce((best, rect) =>
    Math.abs((rect.top + rect.bottom) / 2 - clientY) <
    Math.abs((best.top + best.bottom) / 2 - clientY)
      ? rect
      : best,
  );
}

const TOOLTIP_GAP = 8;

/**
 * The evidence tooltip, placed against the viewport rather than the passage: above the hovered
 * line when there is room, below it otherwise, and shifted sideways to stay fully on screen.
 */
function EvidenceTooltip({ text, anchor }: { text: string; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Measured before paint, so the tooltip never flashes at a position it is then moved from.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - TOOLTIP_GAP;
    const left = Math.max(TOOLTIP_GAP, Math.min(anchor.left, maxLeft));
    const above = anchor.top - height - TOOLTIP_GAP;
    const top = above >= TOOLTIP_GAP ? above : anchor.bottom + TOOLTIP_GAP;
    setPosition({ left, top });
  }, [anchor, text]);

  return (
    <div
      ref={ref}
      className="evidence-tooltip"
      role="tooltip"
      style={
        position
          ? { left: position.left, top: position.top }
          : { left: 0, top: 0, visibility: "hidden" }
      }
    >
      {text}
    </div>
  );
}

export function GradedFreeResponse({ review }: { review: FreeResponseReview }) {
  const [active, setActive] = useState<number[]>([]);
  const [tip, setTip] = useState<{ text: string; anchor: DOMRect } | null>(null);

  // A fixed-position tooltip would drift from its passage on scroll, so scrolling closes it.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [tip]);

  function showTip(criteria: number[], text: string, element: HTMLElement, clientY?: number) {
    setActive(criteria);
    setTip({ text, anchor: anchorRect(element, clientY) });
  }

  function hideTip() {
    setActive([]);
    setTip(null);
  }
  const grades = review.criterionGrades;
  const idPrefix = `criterion-${review.questionId}`;

  const unanswered = review.skipped
    ? "Skipped — no response was submitted."
    : review.timedOut
      ? "Not answered — the overall time limit ran out."
      : null;

  const segments = grades
    ? segmentByEvidence(
        review.response,
        grades.map((grade) => grade.spans),
      )
    : [{ text: review.response, criteria: [] as number[] }];

  return (
    <div className="free-review">
      <h3>
        <MathText text={review.prompt} />
      </h3>
      <div>
        <span className="review-label">Your response</span>
        <p className="graded-response">
          {unanswered ??
            segments.map((segment, index) => {
              if (segment.criteria.length === 0 || !grades) {
                return <MathText key={index} text={segment.text} />;
              }
              const label = segment.criteria
                .map((criterion) => {
                  const grade = grades[criterion];
                  return `${criterion + 1}. ${criterionName(grade.criterion)}: ${formatPoints(grade.awarded)}/${formatPoints(grade.points)}`;
                })
                .join("\n");
              const highlighted = segment.criteria.some((criterion) => active.includes(criterion));
              return (
                <mark
                  key={index}
                  className={`evidence criterion-colour-${segment.criteria[0] % CRITERION_COLOURS}${
                    segment.criteria.length > 1 ? " evidence-shared" : ""
                  }${highlighted ? " active" : ""}`}
                  tabIndex={0}
                  aria-describedby={segment.criteria
                    .map((criterion) => `${idPrefix}-${criterion}`)
                    .join(" ")}
                  onMouseEnter={(event) =>
                    showTip(segment.criteria, label, event.currentTarget, event.clientY)
                  }
                  onMouseMove={(event) => {
                    // A wrapped passage spans several lines; follow the one under the pointer.
                    const anchor = anchorRect(event.currentTarget, event.clientY);
                    if (tip && anchor.top !== tip.anchor.top) setTip({ text: label, anchor });
                  }}
                  onMouseLeave={hideTip}
                  onFocus={(event) => showTip(segment.criteria, label, event.currentTarget)}
                  onBlur={hideTip}
                >
                  <MathText text={segment.text} />
                </mark>
              );
            })}
        </p>
        {tip && <EvidenceTooltip text={tip.text} anchor={tip.anchor} />}
        {grades && !unanswered && (
          <p className="hint evidence-hint">
            Underlined passages are what each criterion was marked on. Hover over one to see which.
          </p>
        )}
      </div>
      <div>
        <span className="review-label">Rubric</span>
        <p>
          <MathText text={review.rubric.summary} />
        </p>
        <ul className={grades ? "graded-criteria" : undefined}>
          {review.rubric.criteria.map((criterion, index) => {
            const grade = grades?.[index];
            return (
              <li
                key={criterion.criterion}
                id={`${idPrefix}-${index}`}
                className={grade && active.includes(index) ? "active" : undefined}
                onMouseEnter={grade ? () => setActive([index]) : undefined}
                onMouseLeave={grade ? () => setActive([]) : undefined}
              >
                <div className="criterion-head">
                  {grade && (
                    <span
                      className={`criterion-badge criterion-colour-${index % CRITERION_COLOURS}`}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                  )}
                  <strong>
                    {/* The badge carries the number when graded, so the name drops its own. */}
                    <MathText
                      text={grade ? criterionName(criterion.criterion) : criterion.criterion}
                    />
                  </strong>
                  <span className="criterion-points">
                    {grade
                      ? `${formatPoints(grade.awarded)} / ${formatPoints(criterion.points)} points`
                      : `${formatPoints(criterion.points)} points`}
                  </span>
                </div>
                <span>
                  <MathText text={criterion.guidance} />
                </span>
                {grade?.justification && (
                  <p className="criterion-justification">
                    <MathText text={grade.justification} />
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <span className="review-label">Grading feedback</span>
        <p>
          <MathText text={review.feedback} />
        </p>
      </div>
    </div>
  );
}
