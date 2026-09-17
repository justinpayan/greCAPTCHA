import { NextResponse } from "next/server";

import { createAccountSession, registerAccount } from "@/lib/accounts";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
      passwordConfirmation?: unknown;
      openrouterApiKey?: unknown;
    };
    const password = String(body.password ?? "");
    if (password !== String(body.passwordConfirmation ?? "")) {
      throw new Error("Passwords do not match.");
    }
    const user = await registerAccount({
      username: String(body.username ?? ""),
      password,
      openrouterApiKey: String(body.openrouterApiKey ?? ""),
    });
    const response = NextResponse.json({ ok: true }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, await createAccountSession(user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
