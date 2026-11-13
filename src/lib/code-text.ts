/**
 * Splits generated text into prose and code: fenced blocks (```lang … ```) and inline `code`.
 *
 * Questions about a codebase quote code, and code is full of characters the prose renderer reads
 * as LaTeX delimiters (`$`, `\(`), so code is taken out before the prose reaches it and shown
 * verbatim. An unclosed fence or backtick is left as prose rather than swallowing the rest of the
 * question. Shared by the browser and the server, so no `server-only`.
 */
export type TextPiece =
  | { type: "text"; value: string }
  | { type: "inline-code"; value: string }
  | { type: "code-block"; value: string; language: string };

const FENCE = /```([\w+#.-]*)[^\S\n]*\n([\s\S]*?)\n?```/g;
const INLINE = /(?<!`)`([^`\n]+)`(?!`)/g;

function splitInline(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) pieces.push({ type: "text", value: text.slice(last, match.index) });
    pieces.push({ type: "inline-code", value: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ type: "text", value: text.slice(last) });
  return pieces;
}

export function splitCode(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    if (match.index > last) pieces.push(...splitInline(text.slice(last, match.index)));
    pieces.push({ type: "code-block", value: match[2], language: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push(...splitInline(text.slice(last)));
  return pieces;
}
