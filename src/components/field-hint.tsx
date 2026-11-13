/**
 * Helper text for a field that shares a grid row with another field. Rendered as a bubble
 * anchored to the label so it takes no vertical space and cannot misalign its neighbour.
 */
export function FieldHint({ text }: { text: string }) {
  return (
    <span className="field-hint" tabIndex={0}>
      <span className="field-hint-mark" aria-hidden="true">
        ?
      </span>
      <span className="field-hint-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
