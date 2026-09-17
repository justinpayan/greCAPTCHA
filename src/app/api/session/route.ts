import { NextResponse } from "next/server";

import {
  authenticateAccount,
  createAccountSession,
  deleteAccountSession,
} from "@/lib/accounts";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    username?: unknown;
    password?: unknown;
  };
  const user = await authenticateAccount(String(body.username ?? ""), String(body.password ?? ""));
  if (!user) return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createAccountSession(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

/** Signs out by clearing the cookie. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  return NextResponse.json({ username: user.username, apiKeyConfigured: true });
}

export async function DELETE(request: Request) {
  const token = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  await deleteAccountSession(decodeURIComponent(token ?? ""));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
