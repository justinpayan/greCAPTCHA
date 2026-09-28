import "server-only";

import { fetchPdfLink, parsePdfLink, PdfLinkTooLargeError } from "@/lib/pdf-link";
import { MAX_PDF_BYTES, pdfTooLargeMessage } from "@/lib/uploads";

/**
 * Where a submitted manuscript comes from: an uploaded file (`paper`) or a link to one
 * (`paperUrl`). Shared by the course and conference routes so both accept either, with the same
 * checks and the same messages.
 */
export type ManuscriptSource = { kind: "file"; file: File } | { kind: "link"; url: URL };

/** A manuscript over the size ceiling, so a route can answer 413 rather than 400. */
export class ManuscriptTooLargeError extends Error {}

/**
 * Reads and checks the form's manuscript fields without fetching anything, so every cheap
 * validation can run before a link is downloaded.
 */
export function readManuscriptSource(form: FormData): ManuscriptSource {
  const link = String(form.get("paperUrl") ?? "").trim();
  const file = form.get("paper");
  const hasFile = file instanceof File && file.size > 0;
  if (link && hasFile) throw new Error("Upload a PDF or link to one, not both.");
  if (link) return { kind: "link", url: parsePdfLink(link) };
  if (!hasFile) throw new Error("Choose a PDF manuscript, or link to one.");
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF files are supported.");
  }
  if (file.size > MAX_PDF_BYTES) throw new ManuscriptTooLargeError(pdfTooLargeMessage(file.size));
  return { kind: "file", file };
}

/** The manuscript as a `File`: downloaded when it was linked, then checked to be a real PDF. */
export async function loadManuscript(source: ManuscriptSource): Promise<File> {
  if (source.kind === "link") {
    try {
      // The download checks the PDF signature itself.
      return await fetchPdfLink(source.url);
    } catch (error) {
      if (error instanceof PdfLinkTooLargeError) throw new ManuscriptTooLargeError(error.message);
      throw error;
    }
  }
  const signature = Buffer.from(await source.file.slice(0, 5).arrayBuffer()).toString("ascii");
  if (signature !== "%PDF-") throw new Error("The selected file is not a valid PDF.");
  return source.file;
}
