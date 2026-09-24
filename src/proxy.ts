import { NextResponse, type NextRequest } from "next/server";

import { logIncoming } from "@/lib/request-log";

const SESSION_COOKIE = "rc_session";

const ALWAYS_OPEN = new Set([
  "/login",
  "/signup",
  "/api/session",
  "/api/signup",
  "/api/health",
]);

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

  if (ALWAYS_OPEN.has(pathname)) {
    logIncoming(method, pathname, "open");
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

  logIncoming(method, pathname, "redirect to /login");
  const target = new URL("/login", requestOrigin(request));
  if (pathname !== "/") target.searchParams.set("next", pathname);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
