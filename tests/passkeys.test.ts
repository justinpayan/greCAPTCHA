import { chromium } from "playwright-core";
import { beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const cookieState = vi.hoisted(() => ({} as Record<string, string>));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => cookieState[key] ? { value: cookieState[key] } : undefined }) }));
import { POST as securityAction } from "@/app/api/account/security/route";
import { POST as passwordSignIn } from "@/app/api/session/route";
import { requireTestAdministrator } from "@/lib/session";
import { db } from "@/db";
import { accountTokens, users } from "@/db/schema";
import { registerAccount } from "@/lib/accounts";
import { accountById, beginEnrollment, finishEnrollment, issueToken, readToken, trustedBrowser, verifyLoginChallenge } from "@/lib/account-security";
import { openSecret, secretHash, totpCode } from "@/lib/account-crypto";
import { startKey, finishKey, assertionOptions, verifyAssertion, removeMethod, listedKeys } from "@/lib/passkeys";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

beforeEach(() => {
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("PUBLIC_BASE_URL", "https://grecaptcha.example.org");
});

// Run with PASSKEY_BROWSER_TEST=1 and an installed Chrome, or set CHROME_PATH.
it.skipIf(!process.env.PASSKEY_BROWSER_TEST)("registers and authenticates a virtual passkey and enforces challenge boundaries", async () => {
  const browser = await chromium.launch({ channel: "chrome", executablePath: process.env.CHROME_PATH });
  try {
    const page = await browser.newPage();
    await page.route("https://grecaptcha.example.org/**", route => route.fulfill({ contentType: "text/html", body: "<title>Account security test</title>" }));
    await page.goto("https://grecaptcha.example.org");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    } });
    let password = "virtual authenticator test";
    const account = await registerAccount({ username: "passkeytester", password });
    db.update(users).set({ verifiedEmail: "passkey@example.org" }).where(eq(users.id, account.id)).run();
    const user = () => accountById(account.id);
    const registration = await startKey(user(), password, "", "My phone");
    const key = await page.evaluate(async options => {
      const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options as PublicKeyCredentialCreationOptionsJSON);
      const result = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;
      return result.toJSON();
    }, registration.options) as RegistrationResponseJSON;
    const first = await finishKey(user(), registration.ticket, key);
    expect(first.codes).toHaveLength(10);
    expect(listedKeys(account.id)).toHaveLength(1);
    await expect(finishKey(user(), registration.ticket, key)).rejects.toThrow();
    const request = (body: Record<string, unknown>) => new Request("https://grecaptcha.example.org/api/account/security", {
      method: "POST", headers: { origin: "https://grecaptcha.example.org", host: "grecaptcha.example.org" }, body: JSON.stringify(body)
    });
    const signedIn = await passwordSignIn(request({ username: account.username, password }));
    expect((await signedIn.json()).next).toBe("/account/challenge");
    cookieState.rc_auth_challenge = signedIn.headers.get("set-cookie")!.match(/rc_auth_challenge=([^;]+)/)![1];
    const body = { action: "challenge", remember: true };
    const prepared = await securityAction(request({ ...body, preparePasskey: true }));
    const preparedBody = await prepared.json();
    const signed = await page.evaluate(async options => {
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options);
      return (await navigator.credentials.get({ publicKey }) as PublicKeyCredential).toJSON();
    }, preparedBody.options);
    const accepted = await securityAction(request({ ...body, assertion: signed, ticket: preparedBody.ticket }));
    expect(accepted.status).toBe(200);
    cookieState.rc_session = accepted.headers.get("set-cookie")!.match(/rc_session=([^;]+)/)![1];
    expect((await requireTestAdministrator()).id).toBe(account.id);
    const recovery = { action: "reset-password", token: issueToken(user(), "reset", 1800),
      password: "updated virtual account password", confirmation: "updated virtual account password" };
    const resetOptions = await (await securityAction(request({ ...recovery, preparePasskey: true }))).json();
    const resetAssertion = await page.evaluate(async options => {
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options);
      return (await navigator.credentials.get({ publicKey }) as PublicKeyCredential).toJSON();
    }, resetOptions.options);
    expect((await securityAction(request({ ...recovery, password: "a different password", ticket: resetOptions.ticket, assertion: resetAssertion }))).status).toBe(400);
    expect((await securityAction(request({ ...recovery, ticket: resetOptions.ticket, assertion: resetAssertion }))).status).toBe(200);
    await expect(requireTestAdministrator()).rejects.toThrow();
    password = recovery.password;
    const login = issueToken(user(), "login", 600);
    const auth = await assertionOptions(user(), login);
    const assertion = await page.evaluate(async options => {
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON);
      const result = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
      return result.toJSON();
    }, auth.options) as AuthenticationResponseJSON;
    await expect(verifyAssertion(user(), "other operation", auth.ticket, assertion)).rejects.toThrow();
    vi.stubEnv("PUBLIC_BASE_URL", "https://other.example.org");
    await expect(verifyAssertion(user(), login, auth.ticket, assertion)).rejects.toThrow();
    vi.stubEnv("PUBLIC_BASE_URL", "https://grecaptcha.example.org");
    const proof = await verifyAssertion(user(), login, auth.ticket, assertion);
    const verified = verifyLoginChallenge(login, proof, true, "Test browser");
    expect(trustedBrowser(user(), verified.deviceToken!)).toBeTruthy();
    await expect(verifyAssertion(user(), login, auth.ticket, assertion)).rejects.toThrow();
    const expired = await assertionOptions(user(), login);
    db.update(accountTokens).set({ expiresAt: new Date(0).toISOString() }).where(eq(accountTokens.tokenHash, secretHash(expired.ticket))).run();
    await expect(verifyAssertion(user(), login, expired.ticket, assertion)).rejects.toThrow();
    const challenge = await assertionOptions(user(), "cancel");
    expect(await page.evaluate(async options => {
      const abort = new AbortController();
      const promise = navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON), signal: abort.signal });
      abort.abort();
      return promise.then(() => "", err => err.name);
    }, challenge.options)).toBe("AbortError");
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
    const withoutUV = await page.evaluate(async options => {
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON);
      publicKey.userVerification = "discouraged";
      return (await navigator.credentials.get({ publicKey }) as PublicKeyCredential).toJSON();
    }, challenge.options) as AuthenticationResponseJSON;
    await expect(verifyAssertion(user(), "cancel", challenge.ticket, withoutUV)).rejects.toThrow();
    const totp = await beginEnrollment(user(), password, first.codes![0]);
    const secret = openSecret(readToken(totp.enrollmentToken, "enroll").payload!);
    expect(finishEnrollment(user(), totp.enrollmentToken, totpCode(secret, Math.floor(Date.now()/30000))).codes).toEqual([]);
    expect(trustedBrowser(user(), verified.deviceToken!)).toBeFalsy();
    await removeMethod(user(), password, first.codes![1], key.id);
    await removeMethod(user(), password, first.codes![2]);
    expect(user().mfaSecret).toBeNull();
    expect(listedKeys(account.id)).toHaveLength(0);
  } finally { await browser.close(); }
});
