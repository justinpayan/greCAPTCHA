import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

/**
 * Everything is researcher-only except the participant assessment route and the three
 * endpoints it needs. In particular the catalogue endpoints (`/api/question-sets`,
 * `/api/attempts`), generation, templates, and `/api/attempts/<id>/outline` — which
 * carries card names and item descriptions — stay behind the password.
 */

/** `/attempt/<id>` — the link handed to a participant. */
const PARTICIPANT_PAGE = /^\/attempt\/[^/]+$/;

/**
 * `/api/attempts/<id>`, plus its `answers` and `interaction` children. Written so that
 * the bare `/api/attempts` list and the `/outline` plan are NOT matched.
 */
const PARTICIPANT_API = /^\/api\/attempts\/[^/]+(?:\/(?:answers|interaction))?$/;

const ALWAYS_OPEN = new Set(["/login", "/api/session"]);

function isParticipantPath(pathname: string) {
  return PARTICIPANT_PAGE.test(pathname) || PARTICIPANT_API.test(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (ALWAYS_OPEN.has(pathname) || isParticipantPath(pathname)) {
    return NextResponse.next();
  }

  const password = process.env.RESEARCHER_PASSWORD;
  if (!password) {
    // Frictionless locally; fails closed once built for production, so a deployment
    // missing the variable is locked rather than wide open.
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse(
      "RESEARCHER_PASSWORD is not set on this deployment, so the researcher interface is locked.",
      { status: 503 },
    );
  }

  const presented = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (presented && safeEqual(presented, await sessionToken(password))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  if (pathname !== "/") target.searchParams.set("next", pathname);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
