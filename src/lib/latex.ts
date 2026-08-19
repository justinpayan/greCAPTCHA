/**
 * Splits text into plain and LaTeX runs.
 *
 * Deliberately free of any renderer, so the delimiter rules can be reasoned about and tested on
 * their own. `$$…$$` and `\[…\]` are display math, `\(…\)` and `$…$` are inline.
 *
 * The single `$` needs a guard, because papers discuss money as well as mathematics and a
 * question mentioning "$30 for the session and $10 more" must not have half of it swallowed into
 * an equation. Three rules, in order of confidence:
 *
 * 1. The content must hug its delimiters, as TeX itself requires.
 * 2. A backslash, `^`, `_` or brace is an unmistakable LaTeX signal — accept.
 * 3. Otherwise, a leading digit reads as currency and is rejected; anything else is accepted.
 *
 * Rule 3 is what lets `$n$` and `$x$` typeset. Single-letter variables are everywhere in these
 * papers, and an earlier version that demanded a LaTeX signal left them as literal `$n$` on
 * screen. The cost is that `$thirty$` would be typeset as math — italic where it should be
 * upright, which is a blemish rather than a loss of meaning.
 *
 * The unambiguous delimiters need none of this.
 */

export type LatexSegment =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean; source: string };

const DELIMITERS = [
  { open: "$$", close: "$$", display: true, guard: false },
  { open: "\\[", close: "\\]", display: true, guard: false },
  { open: "\\(", close: "\\)", display: false, guard: false },
  { open: "$", close: "$", display: false, guard: true },
] as const;

function looksLikeMath(content: string) {
  if (!content.trim()) return false;
  if (/^\s|\s$/.test(content)) return false;
  if (/[\\^_{}]/.test(content)) return true;
  return !/^\d/.test(content);
}

export function splitLatex(text: string): LatexSegment[] {
  const segments: LatexSegment[] = [];
  let plain = "";
  let index = 0;

  const flush = () => {
    if (plain) segments.push({ type: "text", value: plain });
    plain = "";
  };

  while (index < text.length) {
    const delimiter = DELIMITERS.find((candidate) => text.startsWith(candidate.open, index));
    const contentStart = delimiter ? index + delimiter.open.length : -1;
    const closeAt = delimiter ? text.indexOf(delimiter.close, contentStart) : -1;
    const content = delimiter && closeAt !== -1 ? text.slice(contentStart, closeAt) : "";

    const usable =
      Boolean(delimiter) && closeAt !== -1 && (!delimiter!.guard || looksLikeMath(content));
    if (!usable) {
      plain += text[index];
      index += 1;
      continue;
    }

    flush();
    segments.push({
      type: "math",
      value: content,
      display: delimiter!.display,
      source: text.slice(index, closeAt + delimiter!.close.length),
    });
    index = closeAt + delimiter!.close.length;
  }

  flush();
  return segments;
}

/** Whether anything in the text would be typeset. Cheap enough to call per render. */
export function hasLatex(text: string): boolean {
  return splitLatex(text).some((segment) => segment.type === "math");
}
