/**
 * Reads a JSON response without assuming the body is JSON.
 *
 * A long request can be answered by something other than this app: a proxy that gave up waiting
 * returns its own HTML error page, and `response.json()` then throws a parse error that says
 * nothing about what happened. Generation is the case that matters — a multi-card set can run for
 * minutes, well past the fixed 100-second ceiling Cloudflare applies to a tunnelled origin, while
 * the server carries on and finishes the work.
 */
export class NonJsonResponseError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    const looksLikeHtml = /^\s*</.test(body);
    super(
      looksLikeHtml
        ? `The request was answered by something other than the app (HTTP ${status}). A proxy or gateway most likely timed out while the server was still working.`
        : `The server returned an unreadable response (HTTP ${status}).`,
    );
    this.name = "NonJsonResponseError";
    this.status = status;
  }
}

/** Parsed body on success; throws the API's own error message, or `NonJsonResponseError`. */
export async function readJsonResponse<T = Record<string, unknown>>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new NonJsonResponseError(response.status, body);
  }
  if (!response.ok) {
    const message = (parsed as { error?: unknown })?.error;
    throw new Error(typeof message === "string" ? message : fallbackMessage);
  }
  return parsed as T;
}
