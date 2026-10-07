"use client";

import { useState } from "react";

import { MAX_BATCH_MANUSCRIPTS } from "@/lib/batch-manuscripts";
import { MAX_PDF_BYTES, MAX_PDF_LABEL, pdfTooLargeMessage } from "@/lib/uploads";

/**
 * The manuscript input: either a PDF upload (`paper`) or a link to one (`paperUrl`).
 *
 * Only the chosen input is rendered, so the submitted form carries exactly one of the two fields
 * and the server never has to guess which the researcher meant. A linked PDF is fetched and
 * checked by the server, since most hosts do not let a browser read their files directly.
 *
 * Given `onBatchChange`, it also offers a batch mode: several PDFs (`paper`, repeated) or one link
 * per line (`paperUrls`), each of which the dashboard turns into its own test.
 */
export function ManuscriptField({
  id,
  label = "Manuscript PDF",
  error,
  onError,
  batch = false,
  onBatchChange,
}: {
  id: string;
  label?: string;
  error?: string;
  /** Receives a size refusal as soon as a file is picked, and "" when it clears. */
  onError?: (message: string) => void;
  batch?: boolean;
  /** Offers the Single/Batch choice; without it the field always takes one manuscript. */
  onBatchChange?: (batch: boolean) => void;
}) {
  const [source, setSource] = useState<"file" | "link">("file");

  function choose(next: "file" | "link") {
    setSource(next);
    onError?.("");
  }

  function chooseBatch(next: boolean) {
    onBatchChange?.(next);
    onError?.("");
  }

  return (
    <div className="field full">
      <div className="manuscript-heading">
        <label htmlFor={id}>{batch ? `${label}s` : label}</label>
        <div className="manuscript-options">
        {onBatchChange && (
          <div className="manuscript-source" role="radiogroup" aria-label="How many manuscripts">
            <button
              type="button"
              role="radio"
              aria-checked={!batch}
              className={!batch ? "active" : ""}
              onClick={() => chooseBatch(false)}
            >
              Single
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={batch}
              className={batch ? "active" : ""}
              onClick={() => chooseBatch(true)}
            >
              Batch
            </button>
          </div>
        )}
        <div className="manuscript-source" role="radiogroup" aria-label="How to provide the PDF">
          <button
            type="button"
            role="radio"
            aria-checked={source === "file"}
            className={source === "file" ? "active" : ""}
            onClick={() => choose("file")}
          >
            {batch ? "Upload PDFs" : "Upload PDF"}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={source === "link"}
            className={source === "link" ? "active" : ""}
            onClick={() => choose("link")}
          >
            {batch ? "Link to PDFs" : "Link to PDF"}
          </button>
        </div>
        </div>
      </div>
      {source === "file" ? (
        <>
          <input
            // Remounted on a Single/Batch switch, so files picked for one mode are not kept.
            key={batch ? "batch" : "single"}
            className="control file-control"
            id={id}
            name="paper"
            type="file"
            accept="application/pdf,.pdf"
            multiple={batch}
            required
            // Judged the moment a file is picked, so the size is known before the rest of the
            // form is filled in rather than after pressing Generate.
            onChange={(event) => {
              const tooLarge = [...(event.target.files ?? [])].find(
                (picked) => picked.size > MAX_PDF_BYTES,
              );
              onError?.(
                !tooLarge
                  ? ""
                  : batch
                    ? `“${tooLarge.name}”: ${pdfTooLargeMessage(tooLarge.size)}`
                    : pdfTooLargeMessage(tooLarge.size),
              );
            }}
          />
          <small>
            {batch
              ? `Select up to ${MAX_BATCH_MANUSCRIPTS} PDFs, each up to ${MAX_PDF_LABEL}. Each becomes its own test with its own link.`
              : `PDF only, up to ${MAX_PDF_LABEL}.`}
          </small>
        </>
      ) : batch ? (
        <>
          <textarea
            className="control"
            id={id}
            name="paperUrls"
            rows={5}
            placeholder={"https://arxiv.org/pdf/2609.20481\nhttps://example.org/another-paper.pdf"}
            required
          />
          <small>
            One direct link per line, up to {MAX_BATCH_MANUSCRIPTS} links, each to a publicly
            accessible PDF of up to {MAX_PDF_LABEL}. Each becomes its own test with its own link.
          </small>
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
