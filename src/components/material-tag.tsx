import type { MaterialKind } from "@/lib/quiz";

/**
 * What a test is generated from, as a neutral tag with an icon: a page for a manuscript, angle
 * brackets for a codebase. Neutral so it never reads as one of the workflow colours beside it.
 */
export function MaterialTag({ kind }: { kind: MaterialKind }) {
  const code = kind === "code";
  return (
    <span
      className={`material-tag material-${kind}`}
      title={code ? "Generated from a codebase" : "Generated from a manuscript PDF"}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        {code ? (
          <path
            d="M5.5 4 1.75 8l3.75 4M10.5 4l3.75 4-3.75 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5M6 8.25h4.5M6 11h4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {code ? "Codebase" : "Manuscript"}
    </span>
  );
}
