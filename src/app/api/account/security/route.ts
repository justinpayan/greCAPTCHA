import { secretHash } from "@/lib/account-crypto";
import { issueToken, SettingsGrant } from "@/lib/account-security";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { listedKeys, operationBinding, assertionOptions, verifyAssertion, startKey, finishKey, removeMethod } from "@/lib/passkeys";
import { hasFactor, type Factor } from "@/lib/account-security";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { accountTokens, sessions, trustedDevices } from "@/db/schema";
import { createAccountSession } from "@/lib/accounts";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { currentAccount } from "@/lib/session";
import { assertSameOrigin, enforceRateLimit, RateLimitError, rateLimitResponse } from "@/lib/security";
import { publicErrorMessage } from "@/lib/user-facing-error";
import { deleteAccount, hasRemainingTests } from "@/lib/account-deletion";
import { CHALLENGE_COOKIE, DEVICE_COOKIE, DEVICE_SECONDS, accountById, assertAccountVersion, beginEnrollment, confirmPassword,
  consumeFactor, consumeToken, cookieOptions, finishEnrollment, limitEmail, limitFactor, normalizeEmail, readToken,
  recordChallengeAttempt, regenerateCodes, requestEmail, requestPasswordReset, resetPassword, revokeDevices, verifyEmail, verifyLoginChallenge } from "@/lib/account-security";

export const runtime = "nodejs";

export async function GET() {
  const account = await currentAccount();
  if (!account) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  const devices = db.select({ id: trustedDevices.id, label: trustedDevices.label, createdAt: trustedDevices.createdAt,
    lastUsedAt: trustedDevices.lastUsedAt, expiresAt: trustedDevices.expiresAt }).from(trustedDevices)
    .where(and(eq(trustedDevices.userId, account.id), gt(trustedDevices.expiresAt, new Date().toISOString()))).all();
  return NextResponse.json({ username: account.username, email: account.verifiedEmail, passkeys: listedKeys(account.id), authenticator: Boolean(account.mfaSecret), mfaEnabled: hasFactor(account), mfaVerified: account.mfaVerified, hasRemainingTests: hasRemainingTests(account.id), devices }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const field = (key: string) => typeof body[key] === "string" ? body[key] as string : "";
    const action = field("action");
    const jar = await cookies();
    const response = NextResponse.json({ ok: true });
    response.headers.set("Cache-Control", "no-store");
    const clearCookies = () => {
      for (const name of [SESSION_COOKIE, CHALLENGE_COOKIE, DEVICE_COOKIE]) response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
    };
    const setSession = async (userId: string, authVersion: number, mfaVerified: boolean, trustedDeviceId?: string) => {
      response.cookies.set(SESSION_COOKIE, await createAccountSession(userId, { authVersion, mfaVerified, trustedDeviceId }), { ...cookieOptions, maxAge: SESSION_MAX_AGE_SECONDS });
      response.cookies.set(CHALLENGE_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    };
    let factor: Factor = field("code");
    const json = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    if (body.preparePasskey || body.assertion || body.methodsOnly) {
      const context = action === "challenge" ? jar.get(CHALLENGE_COOKIE)?.value || "" :
        action === "reset-password" ? field("token") : jar.get(SESSION_COOKIE)?.value || "";
      const subject = action === "challenge" || action === "reset-password"
        ? accountById(readToken(context, action === "challenge" ? "login" : "reset").userId)
        : await currentAccount();
      if (!subject) throw new Error("Sign in to continue.");
      if (body.methodsOnly) return json({ passkey: listedKeys(subject.id).length > 0, authenticator: Boolean(subject.mfaSecret) });
      const binding = operationBinding(action, context, body);
      await enforceRateLimit(request, "passkey-options", subject.id, 30, 900, true);
      if (body.preparePasskey) return json(await assertionOptions(subject, binding));
      await limitFactor(request, subject.id);
      try {
        factor = await verifyAssertion(subject, binding, field("ticket"), body.assertion as AuthenticationResponseJSON);
      } catch (error) {
        // Fresh WebAuthn options still belong to the same password sign-in or reset attempt.
        if (action === "challenge") recordChallengeAttempt(context, "login");
        if (action === "reset-password") recordChallengeAttempt(context, "reset");
        throw error;
      }
    }
    if (action === "verify-email") {
      await enforceRateLimit(request, "email-token", "", 20, 900);
      verifyEmail(field("token"));
      clearCookies();
      return response;
    }
    if (action === "forgot-password") {
      await enforceRateLimit(request, "account-email-ip", "", 5, 3600);
      await requestPasswordReset(field("email"), request);
      return response;
    }
    if (action === "reset-password") {
      await enforceRateLimit(request, "reset-submit", "", 10, 900);
      const row = readToken(field("token"), "reset");
      if (!body.assertion) await limitFactor(request, row.userId);
      if (field("password") !== field("confirmation")) throw new Error("Passwords do not match.");
      await resetPassword(field("token"), field("password"), factor);
      clearCookies();
      return response;
    }
    if (action === "challenge") {
      const token = jar.get(CHALLENGE_COOKIE)?.value ?? "";
      const row = readToken(token, "login");
      if (!body.assertion) await limitFactor(request, row.userId);
      const result = verifyLoginChallenge(token, factor, body.remember === true, request.headers.get("user-agent") ?? "Browser");
      await setSession(result.account.id, result.account.authVersion, true, result.trustedDeviceId);
      if (result.deviceToken) response.cookies.set(DEVICE_COOKIE, result.deviceToken, { ...cookieOptions, maxAge: DEVICE_SECONDS });
      return response;
    }
    if (action === "acknowledge-codes") {
      if (body.acknowledged !== true) throw new Error("Confirm that you saved your backup codes.");
      const token = field("token");
      await enforceRateLimit(request, "backup-ack", "", 15, 900);
      const account = db.transaction(() => {
        const row = consumeToken(token, "backup-ack");
        return accountById(row.userId);
      });
      await setSession(account.id, account.authVersion, true);
      return response;
    }
    const account = await currentAccount();
    if (!account) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    await enforceRateLimit(request, "account-security", account.id, 30, 900);
    if (action === "send-verification") {
      const email = normalizeEmail(field("email"));
      await limitEmail(request, email);
      if (!body.assertion) await limitFactor(request, account.id);
      await requestEmail(account, email, field("password"), factor);
      return response;
    }
    if (!account.verifiedEmail) throw new Error("Verify your email before continuing.");
    if (!body.assertion) await limitFactor(request, account.id);
    const session = jar.get(SESSION_COOKIE)?.value || "";
    if (action === "unlock-settings") {
      await confirmPassword(account, field("password"));
      const grant = db.transaction(() => {
        assertAccountVersion(account);
        if (hasFactor(account)) consumeFactor(account, factor);
        return issueToken(account, "manage-factors", 600, secretHash(session));
      });
      return json({ grant });
    }
    const grant = new SettingsGrant(field("grant"), session);
    if (["start-key", "remove-key", "remove-authenticator", "begin-enrollment", "regenerate-codes", "revoke-device"].includes(action)) {
      try { grant.check(account); }
      catch { return NextResponse.json({ unlockRequired: true, error: "Verify your identity again to continue." }, { status: 403 }); }
    }
    if (action === "start-key") return json(await startKey(account, grant, factor, field("name")));
    if (action === "finish-key") return json(await finishKey(account, field("ticket"), body.registration as RegistrationResponseJSON));
    if (action === "remove-key" || action === "remove-authenticator") {
      await removeMethod(account, grant, factor, action === "remove-key" ? field("keyId") : undefined);
      clearCookies();
      return response;
    }
    if (action === "begin-enrollment") return NextResponse.json(await beginEnrollment(account, grant, factor), { headers: { "Cache-Control": "no-store" } });
    if (action === "finish-enrollment") return NextResponse.json(finishEnrollment(account, field("token"), field("code")), { headers: { "Cache-Control": "no-store" } });
    if (action === "regenerate-codes") return NextResponse.json(await regenerateCodes(account, grant, factor), { headers: { "Cache-Control": "no-store" } });
    if (action === "revoke-device") {
      db.transaction(() => {
        assertAccountVersion(account);
        grant.check(account);
        if (!field("deviceId")) return revokeDevices(account.id);
        const device = db.select().from(trustedDevices).where(and(eq(trustedDevices.id, field("deviceId")), eq(trustedDevices.userId, account.id))).get();
        if (!device) throw new Error("Trusted browser not found.");
        db.delete(sessions).where(eq(sessions.trustedDeviceId, device.id)).run();
        db.delete(trustedDevices).where(eq(trustedDevices.id, device.id)).run();
      });
      return response;
    }
    if (action === "delete-account") {
      await deleteAccount(account, field("password"), factor, field("confirmation"));
      clearCookies();
      return response;
    }
    throw new Error("Unknown settings action.");
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return NextResponse.json({ error: publicErrorMessage(error, "Unable to update account settings.") }, { status: 400 });
  }
}
