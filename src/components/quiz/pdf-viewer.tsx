"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

export function PdfViewer({
  fileUrl,
  error,
  label,
}: {
  fileUrl: string | null;
  error: string;
  label: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setViewportWidth(viewport.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const pageWidth = Math.max(280, viewportWidth - 28) * zoom;

  return (
    <section className="pdf-viewer" aria-label={`${label} PDF`}>
      <header className="pdf-toolbar">
        <strong>{label}</strong>
        <div className="pdf-toolbar-controls" aria-label="PDF zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
          >
            −
          </button>
          <button type="button" aria-label="Reset zoom" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
          >
            +
          </button>
        </div>
      </header>
      <div className="pdf-scroll-area" ref={viewportRef}>
        {error ? (
          <p className="pdf-message error">{error}</p>
        ) : fileUrl ? (
          <Document
            file={fileUrl}
            loading={<p className="pdf-message">Loading manuscript…</p>}
            error={<p className="pdf-message error">The manuscript PDF could not be displayed.</p>}
            onLoadSuccess={({ numPages }) => setPageCount(numPages)}
          >
            <div className="pdf-pages">
              {Array.from({ length: pageCount }, (_, index) => (
                <div className="pdf-page" key={index + 1}>
                  <Page
                    pageNumber={index + 1}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    loading={<p className="pdf-message">Loading page {index + 1}…</p>}
                  />
                  <small>
                    Page {index + 1} of {pageCount}
                  </small>
                </div>
              ))}
            </div>
          </Document>
        ) : (
          <p className="pdf-message">Loading manuscript…</p>
        )}
      </div>
    </section>
  );
}
