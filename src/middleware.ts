import { NextResponse, type NextRequest } from "next/server";

import { logIncoming } from "@/lib/request-log";

const SESSION_COOKIE = "rc_session";

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
  "/signup",
  "/api/session",
  "/api/signup",
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

  if (pathname.startsWith("/experiment") || pathname.startsWith("/api/experiments")) {
    return new NextResponse("Not found.", { status: 404 });
  }

  if (ALWAYS_OPEN.has(pathname)) {
    logIncoming(method, pathname, "open");
    return NextResponse.next();
  }
  if (isParticipantRequest(method, pathname)) {
    logIncoming(method, pathname, "participant");
    return NextResponse.next();
  }

  const presented = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (presented) {
    // Routes and server pages validate this opaque token against the sessions table.
    logIncoming(method, pathname, "session presented");
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    logIncoming(method, pathname, "401 no session");
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  logIncoming(method, pathname, "redirect to /signup");
  const target = new URL("/signup", requestOrigin(request));
  if (pathname !== "/") target.searchParams.set("next", pathname);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
