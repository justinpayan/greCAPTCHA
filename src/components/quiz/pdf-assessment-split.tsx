"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { MaterialKind, SourceLocation } from "@/lib/quiz";
import { userFacingMessage } from "@/lib/user-facing-error";

const PdfViewer = dynamic(
  () => import("@/components/quiz/pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => <p className="pdf-message">Loading manuscript viewer…</p>,
  },
);

const CodeViewer = dynamic(
  () => import("@/components/quiz/code-viewer").then((module) => module.CodeViewer),
  {
    ssr: false,
    loading: () => <p className="pdf-message">Loading code viewer…</p>,
  },
);

const MIN_PANE_PX = 340;

/**
 * The source material beside the assessment, in a resizable pane: the manuscript PDF, or for a
 * codebase the code viewer.
 */
export function PdfAssessmentSplit({
  attemptId,
  pdfLabel,
  materialKind = "pdf",
  anchor,
  children,
}: {
  attemptId: string;
  pdfLabel: string;
  materialKind?: MaterialKind;
  /** For a codebase, the current question's file and lines, offered as a jump in the viewer. */
  anchor?: SourceLocation;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [pdfPercent, setPdfPercent] = useState(50);
  const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState("");

  useEffect(() => {
    if (materialKind !== "pdf") return;
    const controller = new AbortController();
    let objectUrl = "";
    setPdfFileUrl(null);
    setPdfError("");

    void fetch(`/api/attempts/${encodeURIComponent(attemptId)}/pdf`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "The manuscript PDF is unavailable.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfFileUrl(objectUrl);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setPdfError(
          userFacingMessage(caught, "The manuscript PDF could not be displayed."),
        );
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attemptId, materialKind]);

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
        {materialKind === "code" ? (
          <CodeViewer attemptId={attemptId} label={pdfLabel} anchor={anchor} />
        ) : (
          <PdfViewer
            fileUrl={pdfFileUrl}
            error={pdfError}
            label={pdfLabel}
          />
        )}
      </div>
      <div
        className="pdf-assessment-divider"
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${materialKind === "code" ? "code" : "manuscript"} and assessment panes`}
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
