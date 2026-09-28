/**
 * Linking a free response to the rubric criteria it earned marks on.
 *
 * The grader quotes the passages of a response that each criterion's marks rest on. Quotes are
 * located here as character ranges of the response as written, so the review can underline
 * exactly those passages. Shared by the server (which locates the quotes once, at grading) and
 * the browser (which splits the response into underlined pieces), so no `server-only`.
 */

export type EvidenceSpan = { start: number; end: number };

/** A stretch of the response and the criteria (by index) whose evidence covers it. */
export type EvidenceSegment = { text: string; criteria: number[] };

/** Case, spacing and quote-mark differences a model introduces when it copies a passage. */
function normalizeChar(char: string): string {
  if (/\s/.test(char)) return " ";
  if ("‘’‛′`".includes(char)) return "'";
  if ("“”„″".includes(char)) return '"';
  if ("‐‑‒–—−".includes(char)) return "-";
  return char.toLocaleLowerCase("en-US");
}

/**
 * The response in normalised form, collapsing runs of whitespace, with a map from each
 * normalised position back to its position in the original.
 */
function normalizeWithMap(text: string): { normalized: string; positions: number[] } {
  let normalized = "";
  const positions: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = normalizeChar(text[index]);
    if (char === " " && (normalized.length === 0 || normalized.endsWith(" "))) continue;
    normalized += char;
    positions.push(index);
  }
  return { normalized, positions };
}

/**
 * Where each quote appears in the response. A quote is matched exactly first, then ignoring case,
 * spacing and typographic quote marks; a quote that still cannot be found (the grader paraphrased)
 * is dropped rather than guessed at. Quotes shorter than a few characters are dropped too, since
 * underlining every "the" would point at nothing.
 */
export function locateEvidence(response: string, quotes: string[]): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  const { normalized, positions } = normalizeWithMap(response);
  for (const raw of quotes) {
    const quote = raw.trim();
    if (quote.length < 3) continue;
    const exact = response.indexOf(quote);
    if (exact !== -1) {
      spans.push({ start: exact, end: exact + quote.length });
      continue;
    }
    const target = normalizeWithMap(quote).normalized.trim();
    if (target.length < 3) continue;
    const found = normalized.indexOf(target);
    if (found === -1) continue;
    spans.push({ start: positions[found], end: positions[found + target.length - 1] + 1 });
  }
  return mergeSpans(spans);
}

function mergeSpans(spans: EvidenceSpan[]): EvidenceSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: EvidenceSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * The response cut at every span boundary, each piece tagged with the criteria covering it, so
 * overlapping evidence for two criteria shows as one underline naming both.
 */
export function segmentByEvidence(
  response: string,
  spansByCriterion: EvidenceSpan[][],
): EvidenceSegment[] {
  const cuts = new Set([0, response.length]);
  for (const spans of spansByCriterion) {
    for (const span of spans) {
      if (span.start >= 0 && span.end <= response.length && span.start < span.end) {
        cuts.add(span.start);
        cuts.add(span.end);
      }
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: EvidenceSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const criteria = spansByCriterion.flatMap((spans, criterion) =>
      spans.some((span) => span.start <= start && span.end >= end) ? [criterion] : [],
    );
    const previous = segments.at(-1);
    // Adjacent pieces covered by the same criteria read as one passage.
    if (previous && previous.criteria.join() === criteria.join()) {
      previous.text += response.slice(start, end);
    } else {
      segments.push({ text: response.slice(start, end), criteria });
    }
  }
  return segments;
}
