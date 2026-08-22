import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";
import { logIncoming } from "@/lib/request-log";

/**
 * Everything is researcher-only except the participant assessment route and the three
 * endpoints it needs. In particular the catalogue endpoints (`/api/question-sets`,
 * `/api/attempts`), generation, templates, and `/api/attempts/<id>/outline` — which
 * carries card names and item descriptions — stay behind the password.
 */

/** `/attempt/<id>` — the link handed to a participant. */
const PARTICIPANT_PAGE = /^\/attempt\/[^/]+$/;

/** `/api/attempts/<id>` — reading the current question. Not the list, not `/outline`. */
const PARTICIPANT_ATTEMPT = /^\/api\/attempts\/[^/]+$/;

/** `/api/attempts/<id>/intro` — the landing page shown before the questions start. */
const PARTICIPANT_INTRO = /^\/api\/attempts\/[^/]+\/intro$/;

/** `/experiment/<id>` — the chained link that runs both blocks of an experiment. */
const PARTICIPANT_EXPERIMENT_PAGE = /^\/experiment\/[^/]+$/;

/**
 * `/api/experiments/<id>/session` — the block order behind a chained link. Deliberately narrow:
 * the experiment list and the DELETE on `/api/experiments/<id>` must stay researcher-only.
 */
const PARTICIPANT_EXPERIMENT_SESSION = /^\/api\/experiments\/[^/]+\/session$/;

/** `/api/attempts/<id>/answers`, `/interaction` and `/timeout`. */
const PARTICIPANT_WRITE =
  /^\/api\/attempts\/[^/]+\/(?:answers|interaction|timeout)$/;

/**
 * `/signup` is a recruitment link and must resolve for people who have no password. The redirect
 * itself lives in `next.config.ts` and is applied ahead of middleware, so this is a belt-and-braces
 * entry rather than the thing that makes it work.
 */
const ALWAYS_OPEN = new Set([
  "/login",
  "/api/session",
  "/api/health",
  "/signup",
]);

/**
 * Method-aware on purpose. `/api/attempts/<id>` also answers DELETE, which must stay
 * researcher-only — a path-only allowlist would let anyone holding a participant link
 * destroy the attempt behind it.
 */
function isParticipantRequest(method: string, pathname: string) {
  if (PARTICIPANT_PAGE.test(pathname)) return method === "GET";
  if (PARTICIPANT_ATTEMPT.test(pathname)) return method === "GET";
  if (PARTICIPANT_INTRO.test(pathname)) return method === "GET";
  if (PARTICIPANT_EXPERIMENT_PAGE.test(pathname)) return method === "GET";
  if (PARTICIPANT_EXPERIMENT_SESSION.test(pathname)) return method === "GET";
  if (PARTICIPANT_WRITE.test(pathname)) return method === "POST";
  return false;
}

/**
 * Origin to build the sign-in redirect from.
 *
 * `request.nextUrl.origin` is not usable here: it reflects the address the server is bound
 * to, so behind a tunnel it yields `localhost:3000` and sends the visitor somewhere they
 * cannot reach. Next rejects a relative Location, so the absolute URL has to come from the
 * request headers instead. The `Host` header is what the client actually asked for, and
 * `x-forwarded-proto` is set by the tunnel because it reaches this server over plain HTTP.
 */
function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const proto =
    forwardedProto ||
    (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  if (ALWAYS_OPEN.has(pathname)) {
    logIncoming(method, pathname, "open");
    return NextResponse.next();
  }
  if (isParticipantRequest(method, pathname)) {
    logIncoming(method, pathname, "participant");
    return NextResponse.next();
  }

  const password = process.env.RESEARCHER_PASSWORD;
  if (!password) {
    // Frictionless locally; fails closed once built for production, so a deployment
    // missing the variable is locked rather than wide open.
    if (process.env.NODE_ENV !== "production") {
      logIncoming(method, pathname, "dev, no password set");
      return NextResponse.next();
    }
    logIncoming(method, pathname, "503 RESEARCHER_PASSWORD missing");
    return new NextResponse(
      "RESEARCHER_PASSWORD is not set on this deployment, so the researcher interface is locked.",
      { status: 503 },
    );
  }

  const presented = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (presented && safeEqual(presented, await sessionToken(password))) {
    logIncoming(method, pathname, "researcher");
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    logIncoming(method, pathname, "401 no session");
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  logIncoming(method, pathname, "redirect to /login");
  const target = new URL("/login", requestOrigin(request));
  if (pathname !== "/") target.searchParams.set("next", pathname);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
