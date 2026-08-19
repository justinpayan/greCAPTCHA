"use client";

import katex from "katex";
import { Fragment, useMemo } from "react";

import { repairDoubleEscapes, splitLatex } from "@/lib/latex";

import "katex/dist/katex.min.css";

/**
 * Renders text that may contain LaTeX, as generated questions about a paper routinely do.
 *
 * Delimiter rules live in `splitLatex`. Anything KaTeX refuses to parse falls back to its
 * original source, delimiters included, so a malformed formula shows as written rather than
 * vanishing or rendering as a red error in the middle of a timed question.
 *
 * KaTeX runs with `trust: false`, so `\href`, `\url` and `\includegraphics` are inert: the only
 * HTML inserted is KaTeX's own escaped output. That matters because this text comes from a model
 * and, on the review screen, from the participant.
 */
type Piece = { html: string } | { text: string };

export function MathText({ text }: { text: string }) {
  const pieces = useMemo<Piece[]>(
    () =>
      splitLatex(text).map((segment) => {
        if (segment.type === "text") return { text: segment.value };
        // Repaired before rendering rather than at generation, so sets already in the database
        // display correctly without being regenerated.
        const source = repairDoubleEscapes(segment.value);
        const render = (displayMode: boolean) =>
          katex.renderToString(source, {
            displayMode,
            throwOnError: true,
            strict: false,
            trust: false,
          });
        try {
          return { html: render(segment.display) };
        } catch {
          // A few environments — `align`, `equation` — exist only in display mode, and one of
          // those written mid-sentence would otherwise fall all the way back to raw source.
          try {
            return { html: render(!segment.display) };
          } catch {
            return { text: segment.source };
          }
        }
      }),
    [text],
  );

  // No math: hand back the string itself so no wrapper markup appears at all.
  if (pieces.length === 1 && "text" in pieces[0]) return <>{pieces[0].text}</>;

  // One wrapper around the whole sequence, because a formula in prose is several runs and some of
  // the places this lands are flex containers. An answer option is `justify-content: space-between`
  // for the review's "correct answer" note, and "1/12 and 1/8" arrived as three flex items — a
  // number pinned to each edge of the button with the "and" stranded in the middle. Wrapped, it is
  // one item and the text simply flows.
  return (
    <span className="math-text">
      {pieces.map((piece, position) =>
        "html" in piece ? (
          <span
            className="math-run"
            key={position}
            dangerouslySetInnerHTML={{ __html: piece.html }}
          />
        ) : (
          // A Fragment, not an element: a stylesheet rule for bare spans has nothing to catch in
          // prose, which is how a rubric criterion once broke across one line per symbol.
          <Fragment key={position}>{piece.text}</Fragment>
        ),
      )}
    </span>
  );
}
