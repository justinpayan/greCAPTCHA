import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  safeEqual,
  sessionToken,
} from "@/lib/auth";

export const runtime = "nodejs";

/** Exchanges the researcher password for a session cookie. */
export async function POST(request: Request) {
  const password = process.env.RESEARCHER_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "RESEARCHER_PASSWORD is not configured on this deployment." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (!safeEqual(String(body.password ?? ""), password)) {
    return NextResponse.json({ error: "That password is not correct." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

/** Signs out by clearing the cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
