import "server-only";

/**
 * The title a PDF declares for itself, for display in place of its file name.
 *
 * Read with pdf.js, which the manuscript viewer already ships, so both places a title can live
 * are covered: the XMP metadata stream (`dc:title`), which modern tools write and which carries
 * proper Unicode, and the older document Info dictionary (`/Title`). XMP wins when both exist.
 *
 * Many PDFs declare a title that is not one — "Microsoft Word - draft3.docx", "untitled", the
 * source file's name — so candidates that look like that are ignored and the caller falls back
 * to the file name. Any parsing failure also just means "no title": a missing title must never
 * stop a question set from being created.
 */

const PLACEHOLDER_TITLES = new Set(["untitled", "title", "no title", "document", "pdf", "paper"]);
const FILE_NAME = /\.(pdf|docx?|odt|rtf|tex|dvi|ps|pages|key|pptx?|md|txt)$/i;
// Prefixes office suites and print drivers put in front of the source file's name.
const TOOL_PREFIX = /^(microsoft (word|powerpoint|excel)|word|powerpoint|excel)\s*-\s*/i;

/** A declared title cleaned up, or null when it is empty or evidently not a real title. */
export function usableTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.replace(/\s+/g, " ").trim();
  if (title.length < 3 || title.length > 300) return null;
  if (TOOL_PREFIX.test(title) || FILE_NAME.test(title)) return null;
  if (PLACEHOLDER_TITLES.has(title.toLowerCase())) return null;
  // A title with no letters at all ("1234", "____") is a placeholder too.
  if (!/\p{L}/u.test(title)) return null;
  return title;
}

export async function extractPdfTitle(bytes: Uint8Array): Promise<string | null> {
  let loading: { destroy(): Promise<void> } | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      // pdf.js takes ownership of the buffer it is given, so it gets a copy.
      data: new Uint8Array(bytes),
      // Only the metadata is needed: no fonts, no rendering, nothing fetched.
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    loading = task;
    const pdf = await task.promise;
    const { info, metadata } = await pdf.getMetadata();
    return (
      usableTitle(metadata?.get("dc:title")) ??
      usableTitle((info as { Title?: unknown } | null)?.Title)
    );
  } catch {
    return null;
  } finally {
    // Releases the parser (and its worker) whether or not a title was found.
    await loading?.destroy().catch(() => undefined);
  }
}
