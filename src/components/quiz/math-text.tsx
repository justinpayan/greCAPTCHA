"use client";

import katex from "katex";
import { useMemo } from "react";

import { splitLatex } from "@/lib/latex";

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
        try {
          return {
            html: katex.renderToString(segment.value, {
              displayMode: segment.display,
              throwOnError: true,
              strict: false,
              trust: false,
            }),
          };
        } catch {
          return { text: segment.source };
        }
      }),
    [text],
  );

  // No math: hand back the string itself so no wrapper markup appears at all.
  if (pieces.length === 1 && "text" in pieces[0]) return <>{pieces[0].text}</>;

  return (
    <>
      {pieces.map((piece, position) =>
        "html" in piece ? (
          <span
            className="math-run"
            key={position}
            dangerouslySetInnerHTML={{ __html: piece.html }}
          />
        ) : (
          <span key={position}>{piece.text}</span>
        ),
      )}
    </>
  );
}
