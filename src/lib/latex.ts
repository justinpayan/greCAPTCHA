/**
 * Splits text into plain and LaTeX runs.
 *
 * Deliberately free of any renderer, so the delimiter rules can be reasoned about and tested on
 * their own. `\(…\)` and `$…$` are inline.
 *
 * `$$…$$` and `\[…\]` are display math **only when they stand alone on their own line**. A model
 * writing grading feedback reaches for `$$` around every fragment, and display math is a centred
 * block with margins above and below — so a sentence mentioning three quantities came out as three
 * centred lines with the prose stranded between them. Mid-sentence, inline is both what was meant
 * and what reads.
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
  { open: "$$", close: "$$", block: true, guard: false },
  { open: "\\[", close: "\\]", block: true, guard: false },
  { open: "\\(", close: "\\)", block: false, guard: false },
  { open: "$", close: "$", block: false, guard: true },
] as const;

/**
 * Whether a block delimiter stands alone, and so should be typeset as display math: nothing but
 * whitespace between it and a line break, at both ends.
 */
function standsAlone(text: string, start: number, end: number) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  return /(^|\n)[ \t]*$/.test(before) && /^[ \t]*($|\n)/.test(after);
}

function looksLikeMath(content: string) {
  if (!content.trim()) return false;
  if (/^\s|\s$/.test(content)) return false;
  if (/[\\^_{}]/.test(content)) return true;
  return !/^\d/.test(content);
}

/**
 * Repairs double-escaped TeX commands inside a formula.
 *
 * A model writing JSON reaches for `"\\\\lambda"` about as often as `"\\lambda"`, and the first
 * parses to the two characters `\\` followed by `lambda`. In TeX `\\` is a line break, so KaTeX
 * faithfully renders a break and then the letters — a rubric criterion came out reading
 * "mathcalO(lambda3)" instead of 𝒪(λ³), with no parse error to catch it.
 *
 * Counting the run is what makes this safe. An odd number of backslashes before a letter is a real
 * command and is left alone, including `\\\\alpha`, which is a genuine line break followed by
 * `\alpha`. An even number is an escaping artefact and is halved.
 */
export function repairDoubleEscapes(source: string): string {
  return source.replace(/\\+(?=[A-Za-z])/g, (run) =>
    run.length % 2 === 0 ? "\\".repeat(run.length / 2) : run,
  );
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

    const closeEnd = closeAt + delimiter!.close.length;
    flush();
    segments.push({
      type: "math",
      value: content,
      display: delimiter!.block && standsAlone(text, index, closeEnd),
      source: text.slice(index, closeEnd),
    });
    index = closeEnd;
  }

  flush();
  return segments;
}

/** Whether anything in the text would be typeset. Cheap enough to call per render. */
export function hasLatex(text: string): boolean {
  return splitLatex(text).some((segment) => segment.type === "math");
}
