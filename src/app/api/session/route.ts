import { listedKeys } from "@/lib/passkeys";
import { hasFactor } from "@/lib/account-security";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CHALLENGE_COOKIE, DEVICE_COOKIE, cookieOptions, issueToken, trustedBrowser } from "@/lib/account-security";

import {
  authenticateAccount,
  createAccountSession,
  deleteAccountSession,
} from "@/lib/accounts";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import {
  assertSameOrigin,
  enforceRateLimit,
  rateLimitResponse,
  RateLimitError,
} from "@/lib/security";
import { currentUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json().catch(() => ({}))) as {
      username?: unknown;
      password?: unknown;
    };
    await enforceRateLimit(request, "login", String(body.username ?? ""), 10, 15 * 60);
    const user = await authenticateAccount(
      String(body.username ?? ""),
      String(body.password ?? ""),
    );
    if (!user) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    const trusted = trustedBrowser(user, (await cookies()).get(DEVICE_COOKIE)?.value ?? "");
    if (hasFactor(user) && !trusted) {
      const response = NextResponse.json({ ok: true, next: "/account/challenge", methods: { passkey: listedKeys(user.id).length > 0, authenticator: Boolean(user.mfaSecret) } });
      response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      response.cookies.set(CHALLENGE_COOKIE, issueToken(user, "login", 600), { ...cookieOptions, maxAge: 600 });
      return response;
    }
    const response = NextResponse.json({ ok: true, next: !user.verifiedEmail ? "/account/email" : !hasFactor(user) ? "/account/onboarding" : undefined });
    response.cookies.set(SESSION_COOKIE, await createAccountSession(user.id, {
      authVersion: user.authVersion, mfaVerified: Boolean(trusted), trustedDeviceId: trusted?.id,
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    const message = publicErrorMessage(error, "Unable to sign in.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Signs out by clearing the cookie. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  return NextResponse.json({ username: user.username });
}

export async function DELETE(request: Request) {
  assertSameOrigin(request);
  const token = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  await deleteAccountSession(decodeURIComponent(token ?? ""));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(CHALLENGE_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
