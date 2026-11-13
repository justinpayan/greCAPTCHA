import { Fragment } from "react";

import { MathText } from "@/components/quiz/math-text";
import { splitCode } from "@/lib/code-text";
import { GRADING_SUMMARY_SEPARATOR } from "@/lib/quiz";

/**
 * Prose that may quote code. Code is shown verbatim, and only the prose between it goes to the
 * LaTeX renderer. A code block is a span shown as a block, because the question often sits inside
 * a paragraph, where a `<pre>` would be invalid markup.
 */
function PromptText({ text }: { text: string }) {
  const pieces = splitCode(text);
  if (pieces.length === 1 && pieces[0].type === "text") return <MathText text={text} />;
  return (
    <>
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {piece.type === "text" ? (
            <MathText text={piece.value} />
          ) : piece.type === "inline-code" ? (
            <code className="prompt-inline-code">{piece.value}</code>
          ) : (
            <span className="prompt-code-block" role="figure" aria-label="Code">
              <code>{piece.value}</code>
            </span>
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A question's text. A fixed-rubric question ends with how it is graded, which is set apart on its
 * own line with a gap above it, so the participant does not read it as part of the question.
 */
export function QuestionPrompt({ text }: { text: string }) {
  const at = text.lastIndexOf(GRADING_SUMMARY_SEPARATOR);
  if (at < 0) return <PromptText text={text} />;
  return (
    <>
      <PromptText text={text.slice(0, at)} />
      {/* A span shown as a block, because the question often sits inside a paragraph. */}
      <span className="grading-summary">
        <MathText text={text.slice(at).trim()} />
      </span>
    </>
  );
}
