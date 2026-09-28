"use client";

import { useState } from "react";

import { MAX_PDF_BYTES, MAX_PDF_LABEL, pdfTooLargeMessage } from "@/lib/uploads";

/**
 * The manuscript input: either a PDF upload (`paper`) or a link to one (`paperUrl`).
 *
 * Only the chosen input is rendered, so the submitted form carries exactly one of the two fields
 * and the server never has to guess which the researcher meant. A linked PDF is fetched and
 * checked by the server, since most hosts do not let a browser read their files directly.
 */
export function ManuscriptField({
  id,
  label = "Manuscript PDF",
  error,
  onError,
}: {
  id: string;
  label?: string;
  error?: string;
  /** Receives a size refusal as soon as a file is picked, and "" when it clears. */
  onError?: (message: string) => void;
}) {
  const [source, setSource] = useState<"file" | "link">("file");

  function choose(next: "file" | "link") {
    setSource(next);
    onError?.("");
  }

  return (
    <div className="field full">
      <div className="manuscript-heading">
        <label htmlFor={id}>{label}</label>
        <div className="manuscript-source" role="radiogroup" aria-label="How to provide the PDF">
          <button
            type="button"
            role="radio"
            aria-checked={source === "file"}
            className={source === "file" ? "active" : ""}
            onClick={() => choose("file")}
          >
            Upload PDF
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={source === "link"}
            className={source === "link" ? "active" : ""}
            onClick={() => choose("link")}
          >
            Link to PDF
          </button>
        </div>
      </div>
      {source === "file" ? (
        <>
          <input
            className="control file-control"
            id={id}
            name="paper"
            type="file"
            accept="application/pdf,.pdf"
            required
            // Judged the moment a file is picked, so the size is known before the rest of the
            // form is filled in rather than after pressing Generate.
            onChange={(event) => {
              const picked = event.target.files?.[0];
              onError?.(
                picked && picked.size > MAX_PDF_BYTES ? pdfTooLargeMessage(picked.size) : "",
              );
            }}
          />
          <small>PDF only, up to {MAX_PDF_LABEL}.</small>
        </>
      ) : (
        <>
          <input
            className="control"
            id={id}
            name="paperUrl"
            type="url"
            inputMode="url"
            placeholder="https://arxiv.org/pdf/2609.20481"
            required
          />
          <small>
            A direct link to a publicly accessible PDF, up to {MAX_PDF_LABEL}. It is downloaded
            and checked when you submit.
          </small>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
