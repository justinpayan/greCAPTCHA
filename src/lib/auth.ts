/**
 * Shared-secret session helpers.
 *
 * Deliberately dependency-free and Web Crypto only, because middleware runs on the Edge
 * runtime where Node's `crypto` is unavailable. No secret lives in this file: the token is
 * derived from `RESEARCHER_PASSWORD` on both the login route and the middleware.
 */

export const SESSION_COOKIE = "rc_session";

/** Twelve hours: long enough for a full day of sessions, short enough to expire overnight. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Cookie value for a given password. The raw password is never sent to the browser. */
export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`research-captcha:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-independent comparison, so a wrong value cannot be narrowed down by timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
