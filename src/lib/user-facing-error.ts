/**
 * The message to show a person for a caught error.
 *
 * The app's own errors (validation messages, server refusals rebuilt from a response's
 * `error` field, `OpenRouterError`) are written for people and are shown as they are. Errors the
 * browser or runtime raises itself are not: a refused permission reads "Failed to execute
 * 'writeText' on 'Clipboard': …", a dropped connection "Failed to fetch", an HTML error page
 * "Unexpected token '<' …". Those are replaced by the caller's plain fallback, or a connection
 * message when the request never reached the server. Shared by every page, so no `server-only`.
 */
export const CONNECTION_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

export function userFacingMessage(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) return fallback;
  // DOMException covers refused permissions, aborted requests, and security errors.
  if (typeof DOMException !== "undefined" && caught instanceof DOMException) return fallback;
  // A fetch that never got a response throws a bare TypeError ("Failed to fetch", "Load failed",
  // "NetworkError when attempting to fetch resource").
  if (caught instanceof TypeError) {
    return /fetch|network|load failed/i.test(caught.message) ? CONNECTION_MESSAGE : fallback;
  }
  // An unparsable response body, and programming errors, have nothing a person can act on.
  if (
    caught instanceof SyntaxError ||
    caught instanceof RangeError ||
    caught instanceof ReferenceError ||
    caught.name === "AbortError" ||
    caught.name === "TimeoutError"
  ) {
    return fallback;
  }
  return caught.message || fallback;
}

/**
 * The server-side counterpart, for API responses: the app's own `Error` messages pass through;
 * errors raised by libraries (a Zod validation dump, a SQLite error, an unparsable request body,
 * a failed internal call) are replaced by the route's fallback, so a response never carries an
 * internal message.
 */
export function publicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (
    error.name === "ZodError" ||
    error.name === "SqliteError" ||
    error instanceof SyntaxError ||
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    (typeof DOMException !== "undefined" && error instanceof DOMException)
  ) {
    return fallback;
  }
  return error.message || fallback;
}
