"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useRef, useState } from "react";

import { PdfViewer } from "@/components/quiz/pdf-viewer";

const MIN_PANE_PX = 340;

export function PdfAssessmentSplit({
  attemptId,
  pdfLabel,
  children,
}: {
  attemptId: string;
  pdfLabel: string;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [pdfPercent, setPdfPercent] = useState(50);

  function resize(clientX: number) {
    const shell = shellRef.current;
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    const minimum = Math.min(45, (MIN_PANE_PX / bounds.width) * 100);
    const next = ((clientX - bounds.left) / bounds.width) * 100;
    setPdfPercent(Math.min(100 - minimum, Math.max(minimum, next)));
  }

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    resize(event.clientX);
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setPdfPercent((value) =>
      Math.min(75, Math.max(25, value + (event.key === "ArrowLeft" ? -3 : 3))),
    );
  }

  const style = {
    "--pdf-pane-percent": `${pdfPercent}%`,
  } as CSSProperties;

  return (
    <div className="pdf-assessment-shell" ref={shellRef} style={style}>
      <div className="pdf-assessment-document">
        <PdfViewer
          url={`/api/attempts/${encodeURIComponent(attemptId)}/pdf`}
          label={pdfLabel}
        />
      </div>
      <div
        className="pdf-assessment-divider"
        role="separator"
        tabIndex={0}
        aria-label="Resize manuscript and assessment panes"
        aria-orientation="vertical"
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(pdfPercent)}
        onDoubleClick={() => setPdfPercent(50)}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
      >
        <span aria-hidden="true" />
      </div>
      <div className="pdf-assessment-content">{children}</div>
    </div>
  );
}
