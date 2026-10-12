import { MathText } from "@/components/quiz/math-text";
import { GRADING_SUMMARY_SEPARATOR } from "@/lib/quiz";

/**
 * A question's text. A fixed-rubric question ends with how it is graded, which is set apart on its
 * own line with a gap above it, so the participant does not read it as part of the question.
 */
export function QuestionPrompt({ text }: { text: string }) {
  const at = text.lastIndexOf(GRADING_SUMMARY_SEPARATOR);
  if (at < 0) return <MathText text={text} />;
  return (
    <>
      <MathText text={text.slice(0, at)} />
      {/* A span shown as a block, because the question often sits inside a paragraph. */}
      <span className="grading-summary">
        <MathText text={text.slice(at).trim()} />
      </span>
    </>
  );
}
