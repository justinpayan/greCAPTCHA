import { NextResponse, type NextRequest } from "next/server";

import { logIncoming } from "@/lib/request-log";

const SESSION_COOKIE = "rc_session";
const PARTICIPANT_PAGE = /^\/attempt\/[^/]+$/;
const PARTICIPANT_ATTEMPT = /^\/api\/attempts\/[^/]+$/;
const PARTICIPANT_INTRO = /^\/api\/attempts\/[^/]+\/intro$/;
const PARTICIPANT_GRADING = /^\/api\/attempts\/[^/]+\/grading$/;
const PARTICIPANT_WRITE =
  /^\/api\/attempts\/[^/]+\/(?:answers|interaction|timeout)$/;

const ALWAYS_OPEN = new Set([
  "/login",
  "/signup",
  "/api/session",
  "/api/signup",
  "/api/health",
]);

function isParticipantRequest(method: string, pathname: string) {
  if (PARTICIPANT_PAGE.test(pathname)) return method === "GET";
  if (PARTICIPANT_ATTEMPT.test(pathname)) return method === "GET";
  if (PARTICIPANT_INTRO.test(pathname)) return method === "GET";
  if (PARTICIPANT_GRADING.test(pathname)) return method === "GET";
  if (PARTICIPANT_WRITE.test(pathname)) return method === "POST";
  return false;
}

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProto ||
    (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${protocol}://${host}`;
}

export function proxy(request: NextRequest) {
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
  if (request.cookies.get(SESSION_COOKIE)?.value) {
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
