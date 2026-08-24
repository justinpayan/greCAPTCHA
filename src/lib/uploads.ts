/**
 * The upload ceiling for a manuscript PDF, shared by the browser and the route handler.
 *
 * No `server-only`: the point of this module is that the form can refuse an oversized file
 * before spending minutes pushing it over a tunnel, using the same numbers the server enforces.
 */

/**
 * The real ceiling, and it is not ours: Next clones the request body so that middleware can read
 * it, and `experimental.middlewareClientMaxBodySize` caps that clone at 10 MiB by default. This
 * app's middleware matches every path, so every upload is cloned. Past the cap the body is
 * **silently truncated** — the handler then receives half a multipart envelope and
 * `request.formData()` fails with "Failed to parse body as FormData", which tells the researcher
 * nothing at all.
 *
 * Left at Next's default deliberately, so nothing here depends on an experimental config key.
 * That makes it a budget for the *whole* request rather than for the PDF, hence the reserve below.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Held back from the budget for everything in the multipart body that is not the PDF: the
 * boundaries and per-part headers, the model ID, the block configuration, and the contributions
 * statement, which has no length limit of its own.
 *
 * 64 KiB is far more than a normal form needs — a few hundred bytes of envelope and a statement
 * of a few thousand characters — and is only 0.6% of the budget, so it costs nothing to be
 * generous. A statement long enough to eat it is caught by the total check on the server.
 */
export const UPLOAD_ENVELOPE_RESERVE = 64 * 1024;

/** The most a PDF may weigh. Slightly under the total, by the reserve above. */
export const MAX_PDF_BYTES = MAX_UPLOAD_BYTES - UPLOAD_ENVELOPE_RESERVE;

/** Binary units, because the limit is a power of two and "10 MB" would be a different number. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${Math.round(kib)} KiB`;
  // A trailing ".0" is dropped so the ceiling reads as "10 MiB" rather than "10.0 MiB".
  return `${(kib / 1024).toFixed(1).replace(/\.0$/, "")} MiB`;
}

/** Advertised ceiling, e.g. "9.9 MiB". Derived so the copy cannot drift from the constant. */
export const MAX_PDF_LABEL = formatBytes(MAX_PDF_BYTES);

/** Advertised total, e.g. "10.0 MiB". */
export const MAX_UPLOAD_LABEL = formatBytes(MAX_UPLOAD_BYTES);

/**
 * Why an oversized PDF was refused, in terms the researcher can act on: how far over it is, what
 * the ceiling is, and that compressing it is the way out.
 *
 * States the **excess** rather than two absolute sizes. Rounded to one decimal, a file a hair over
 * the limit prints the same figure as the limit itself, and "this PDF is 10 MiB, the limit is
 * 10 MiB" reads as a bug in the check rather than a fact about the file.
 *
 * Names the total budget as well, because the PDF's share of it is slightly smaller and a limit
 * that appears to be 10 MiB while refusing a 10 MiB file would otherwise look wrong.
 */
export function pdfTooLargeMessage(bytes: number): string {
  return (
    `This PDF is ${formatBytes(bytes - MAX_PDF_BYTES)} over the limit. ` +
    `An upload may total ${MAX_UPLOAD_LABEL}, and the rest of the form takes a little of that, ` +
    `so the PDF itself must be ${MAX_PDF_LABEL} or smaller. ` +
    `Compressing it — printing to PDF again, or downsampling its images — usually shrinks a ` +
    `figure-heavy manuscript by more than enough.`
  );
}

/**
 * The same refusal when only the total is known, i.e. the PDF's own size was never parsed.
 *
 * `bytes` must be a size that actually exceeds `MAX_UPLOAD_BYTES`, or null when the request
 * declared no length. Passing something under the budget would render a negative excess, and the
 * caller is expected to have established that the upload really is too big.
 */
export function uploadTooLargeMessage(bytes: number | null): string {
  const measured =
    bytes === null
      ? "This upload is over the limit. "
      : `This upload is ${formatBytes(bytes - MAX_UPLOAD_BYTES)} over the limit. `;
  return (
    `${measured}An upload may total ${MAX_UPLOAD_LABEL}, counting the manuscript PDF ` +
    `(${MAX_PDF_LABEL} or smaller) and the contributions statement together. ` +
    `Use a smaller PDF, or a shorter statement, and try again.`
  );
}
