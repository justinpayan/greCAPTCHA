import { MAX_PDF_BYTES, pdfTooLargeMessage } from "@/lib/uploads";

/**
 * Batch generation: one test per manuscript, built from the same form.
 *
 * No `server-only`: the dashboard splits a batch in the browser and sends each manuscript to the
 * single-manuscript endpoints, so every server check, limit, and job queue applies unchanged.
 */

/** Enough for a course or a review cycle, while keeping one click from queueing a flood of jobs. */
export const MAX_BATCH_MANUSCRIPTS = 20;

export type BatchManuscript =
  | { kind: "file"; label: string; file: File }
  | { kind: "link"; label: string; url: string };

/** A short, readable name for a manuscript: the file name, or the last part of a link's path. */
export function manuscriptLabel(source: { file: File } | { url: string }): string {
  if ("file" in source) return source.file.name.replace(/\.pdf$/i, "").trim() || "Manuscript";
  try {
    const url = new URL(source.url);
    const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    return last.replace(/\.pdf$/i, "").trim() || url.hostname;
  } catch {
    return source.url;
  }
}

/**
 * Reads the batch manuscript fields: every picked PDF (`paper`), or one link per line of
 * `paperUrls`. Throws a message the researcher can act on when the batch cannot be sent.
 */
export function readBatchManuscripts(form: FormData): BatchManuscript[] {
  const files = form
    .getAll("paper")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const links = String(form.get("paperUrls") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: BatchManuscript[] = files.length
    ? files.map((file) => ({ kind: "file", label: manuscriptLabel({ file }), file }))
    : [...new Set(links)].map((url) => ({ kind: "link", label: manuscriptLabel({ url }), url }));

  if (items.length === 0) throw new Error("Choose at least one PDF manuscript, or link to one.");
  if (items.length > MAX_BATCH_MANUSCRIPTS) {
    throw new Error(
      `A batch may contain at most ${MAX_BATCH_MANUSCRIPTS} manuscripts; you added ${items.length}.`,
    );
  }
  for (const item of items) {
    if (item.kind !== "file") continue;
    if (item.file.type !== "application/pdf" && !item.file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error(`“${item.file.name}” is not a PDF. Only PDF files are supported.`);
    }
    if (item.file.size > MAX_PDF_BYTES) {
      throw new Error(`“${item.file.name}”: ${pdfTooLargeMessage(item.file.size)}`);
    }
  }
  return items;
}

/**
 * The test name for each manuscript: the shared name followed by the manuscript's label, or the
 * label alone when no shared name was given. Repeated labels are numbered, because test names
 * must be unique within an account.
 */
export function batchTestNames(baseName: string, items: BatchManuscript[]): string[] {
  const base = baseName.trim();
  const seen = new Map<string, number>();
  return items.map((item) => {
    const name = (base ? `${base} — ${item.label}` : item.label).slice(0, 110);
    const key = name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}
