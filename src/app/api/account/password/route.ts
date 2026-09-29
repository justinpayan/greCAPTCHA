import { NextResponse } from "next/server";

import { changeAccountPassword, createAccountSession } from "@/lib/accounts";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import {
  assertSameOrigin,
  enforceRateLimit,
  rateLimitResponse,
  RateLimitError,
} from "@/lib/security";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, "password-change", user.id, 5, 60 * 60);
    const body = (await request.json().catch(() => ({}))) as {
      currentPassword?: unknown;
      newPassword?: unknown;
      passwordConfirmation?: unknown;
    };
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (newPassword !== String(body.passwordConfirmation ?? "")) {
      throw new Error("New passwords do not match.");
    }

    await changeAccountPassword(user.id, currentPassword, newPassword);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, await createAccountSession(user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    const message = error instanceof Error ? error.message : "Unable to change password.";
    return NextResponse.json(
      { error: message },
      { status: message === "Not authorised." ? 401 : 400 },
    );
  }
}
