import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

/**
 * Whether this request carries a valid researcher session.
 *
 * The middleware already answers this question for every researcher-only route, so this
 * exists for the two routes it deliberately leaves open to participants: it lets the
 * assessment endpoints tell "the researcher clicked Start" apart from "someone opened a
 * link that was mailed out early".
 *
 * With no `RESEARCHER_PASSWORD` configured the answer mirrors the middleware exactly —
 * unguarded in development, locked in production — so there is only ever one notion of who
 * counts as the researcher. The development branch means a closed link still opens locally
 * unless a password is set, which is what makes local work frictionless.
 */
export async function hasResearcherSession(): Promise<boolean> {
  const password = process.env.RESEARCHER_PASSWORD;
  if (!password) return process.env.NODE_ENV !== "production";
  const presented = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  return Boolean(presented) && safeEqual(presented, await sessionToken(password));
}
