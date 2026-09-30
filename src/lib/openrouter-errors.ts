/**
 * Telling OpenRouter problems apart from every other failure, so the forms can show them beside
 * the OpenRouter key controls rather than at the bottom of the page.
 *
 * Shared by the server and the browser (no `server-only`). The server throws `OpenRouterError`
 * for key, credential, and provider failures and tags its JSON responses with
 * `errorSource: "openrouter"`; the browser turns a tagged response back into an `OpenRouterError`,
 * so a page's `catch` can route it with a single `instanceof`.
 */

import { publicErrorMessage } from "@/lib/user-facing-error";

export const OPENROUTER_ERROR_SOURCE = "openrouter";

/** A problem with an OpenRouter key or credential, or a failure reported by OpenRouter itself. */
export class OpenRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export function isOpenRouterError(error: unknown): error is OpenRouterError {
  return error instanceof OpenRouterError;
}

/** The body of an error response, tagged when the failure came from OpenRouter. */
export function errorResponseBody(
  error: unknown,
  fallback: string,
): { error: string; errorSource?: typeof OPENROUTER_ERROR_SOURCE } {
  const message = publicErrorMessage(error, fallback);
  return isOpenRouterError(error)
    ? { error: message, errorSource: OPENROUTER_ERROR_SOURCE }
    : { error: message };
}

/**
 * Job failures are stored as plain text, so the tag travels as a prefix on the stored message and
 * is removed again before the message is shown. No schema change needed.
 */
const JOB_ERROR_MARKER = "[openrouter] ";

export function encodeJobError(error: unknown, message: string): string {
  return isOpenRouterError(error) ? `${JOB_ERROR_MARKER}${message}` : message;
}

export function decodeJobError(stored: string | null): {
  error: string | null;
  errorSource?: typeof OPENROUTER_ERROR_SOURCE;
} {
  if (stored?.startsWith(JOB_ERROR_MARKER)) {
    return { error: stored.slice(JOB_ERROR_MARKER.length), errorSource: OPENROUTER_ERROR_SOURCE };
  }
  return { error: stored };
}

/** Browser side: the error a failed response or job describes, as the right class. */
export function errorFromPayload(
  payload: { error?: string | null; errorSource?: string } | undefined,
  fallback: string,
): Error {
  const message = payload?.error || fallback;
  return payload?.errorSource === OPENROUTER_ERROR_SOURCE
    ? new OpenRouterError(message)
    : new Error(message);
}
