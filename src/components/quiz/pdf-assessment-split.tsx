"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const PdfViewer = dynamic(
  () => import("@/components/quiz/pdf-viewer").then((module) => module.PdfViewer),
  {
    ssr: false,
    loading: () => <p className="pdf-message">Loading manuscript viewer…</p>,
  },
);

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
  const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState("");

  useEffect(() => {
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
          caught instanceof Error ? caught.message : "The manuscript PDF could not be displayed.",
        );
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attemptId]);

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
          fileUrl={pdfFileUrl}
          error={pdfError}
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
