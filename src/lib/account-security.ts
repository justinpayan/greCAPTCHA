import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/db";
import { accountTokens, backupCodes, passkeys, sessions, trustedDevices, users } from "@/db/schema";
import { authenticateAccount, passwordFields } from "@/lib/accounts";
import { authenticatorSecret, base32Secret, matchingStep, openSecret, randomToken, sealSecret, secretHash } from "@/lib/account-crypto";
import { mailConfiguration, sendAccountEmail } from "@/lib/account-mail";
import { enforceRateLimit } from "@/lib/security";

export const CHALLENGE_COOKIE = "rc_auth_challenge";
export const DEVICE_COOKIE = "rc_trusted_device";
export const DEVICE_SECONDS = 30 * 24 * 60 * 60;
export const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
export type Account = typeof users.$inferSelect;
const invalidToken = "This link or verification session has expired or was already used. Please start again.";

export function hasFactor(account: Account) {
  return Boolean(account.mfaSecret || db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, account.id)).get());
}

export class VerifiedPasskey {
  constructor(readonly userId: string, readonly authVersion: number) {}
}
export type Factor = string | VerifiedPasskey;

export function accountById(id: string) {
  const account = db.select().from(users).where(eq(users.id, id)).get();
  if (!account) throw new Error("Not authorised.");
  return account;
}

export function issueToken(account: Account, purpose: string, seconds: number, payload?: string) {
  const token = randomToken();
  db.delete(accountTokens).where(lt(accountTokens.expiresAt, new Date().toISOString())).run();
  db.insert(accountTokens).values({ tokenHash: secretHash(token), userId: account.id, purpose,
    authVersion: account.authVersion, payload, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() }).run();
  return token;
}

export function readToken(token: string, purpose: string) {
  const row = db.select().from(accountTokens).where(and(eq(accountTokens.tokenHash, secretHash(token)),
    eq(accountTokens.purpose, purpose), gt(accountTokens.expiresAt, new Date().toISOString()))).get();
  if (!row || accountById(row.userId).authVersion !== row.authVersion) throw new Error(invalidToken);
  return row;
}

export function consumeToken(token: string, purpose: string) {
  const row = readToken(token, purpose);
  if (db.delete(accountTokens).where(eq(accountTokens.tokenHash, row.tokenHash)).run().changes !== 1) throw new Error(invalidToken);
  return row;
}

export async function limitFactor(request: Request, accountId: string) {
  await enforceRateLimit(request, "mfa-account", accountId, 10, 15 * 60, true);
  await enforceRateLimit(request, "mfa-ip", "", 30, 15 * 60);
}

export function recordChallengeAttempt(token: string, purpose: string) {
  const row = readToken(token, purpose);
  const updated = db.update(accountTokens).set({ attempts: sql`${accountTokens.attempts} + 1` }).where(and(
    eq(accountTokens.tokenHash, row.tokenHash), lt(accountTokens.attempts, 5),
  )).run();
  if (updated.changes !== 1) throw new Error("Too many verification attempts. Please start again.");
  return row;
}

/** Runs inside the same transaction as the protected change or session challenge consumption. */
export function consumeFactor(account: Account, code: Factor): "totp" | "backup" | "passkey" {
  if (code instanceof VerifiedPasskey) {
    assertAccountVersion(account);
    if (account.id !== code.userId || account.authVersion !== code.authVersion) throw new Error(invalidToken);
    return "passkey";
  }
  const normalized = code.trim().replace(/[\s-]/g, "").toUpperCase();
  if (account.mfaSecret && /^\d{6}$/.test(normalized)) {
    const step = matchingStep(openSecret(account.mfaSecret), normalized, account.mfaLastStep);
    if (step !== null) {
      const result = db.update(users).set({ mfaLastStep: step }).where(and(eq(users.id, account.id),
        eq(users.authVersion, account.authVersion), lt(users.mfaLastStep, step))).run();
      if (result.changes === 1) return "totp";
    }
  } else if (db.delete(backupCodes).where(and(eq(backupCodes.userId, account.id),
    eq(backupCodes.codeHash, secretHash(normalized)))).run().changes === 1) return "backup";
  throw new Error("The verification code is invalid or was already used. Try the next authenticator code or a backup code.");
}

export async function confirmPassword(account: Account, password: string) {
  const authenticated = await authenticateAccount(account.username, password);
  if (!authenticated || authenticated.authVersion !== account.authVersion) throw new Error("Current password is incorrect or your account security changed.");
}

/** A short-lived capability issued after verifying the password and existing factor. */
export class SettingsGrant {
  constructor(readonly token: string, readonly session: string) {}

  check(account: Account) {
    const grant = readToken(this.token, "manage-factors");
    if (grant.userId !== account.id || grant.payload !== secretHash(this.session)) {
      throw new Error("Verify your identity again to manage security methods.");
    }
  }
}

export async function checkManagementPassword(account: Account, credential: string | SettingsGrant) {
  if (credential instanceof SettingsGrant) credential.check(account);
  else await confirmPassword(account, credential);
}

// Check again inside the transaction that changes the factor.
export function checkManagementFactor(account: Account, credential: string | SettingsGrant, factor: Factor) {
  assertAccountVersion(account);
  if (credential instanceof SettingsGrant) credential.check(account);
  else if (hasFactor(account)) consumeFactor(account, factor);
}

export function assertAccountVersion(account: Account) {
  if (accountById(account.id).authVersion !== account.authVersion) throw new Error("Your account security changed. Sign in again.");
}

export function revokeDevices(userId: string) {
  const devices = db.select().from(trustedDevices).where(eq(trustedDevices.userId, userId)).all();
  if (devices.length) db.delete(sessions).where(inArray(sessions.trustedDeviceId, devices.map((d) => d.id))).run();
  db.delete(trustedDevices).where(eq(trustedDevices.userId, userId)).run();
}

export function revokeAuthentication(userId: string) {
  db.update(users).set({ authVersion: sql`${users.authVersion} + 1`, updatedAt: new Date().toISOString() }).where(eq(users.id, userId)).run();
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  db.delete(accountTokens).where(eq(accountTokens.userId, userId)).run();
  revokeDevices(userId);
}

export function newBackupCodes(userId: string) {
  db.delete(backupCodes).where(eq(backupCodes.userId, userId)).run();
  const codes = Array.from({ length: 10 }, () => randomBytes(10).toString("hex").toUpperCase());
  db.insert(backupCodes).values(codes.map((code) => ({ userId, codeHash: secretHash(code) }))).run();
  return codes.map((code) => code.match(/.{1,5}/g)!.join("-"));
}

export async function beginEnrollment(account: Account, password: string | SettingsGrant, code: Factor) {
  if (!account.verifiedEmail) throw new Error("Verify your email before setting up MFA.");
  await checkManagementPassword(account, password);
  const secret = authenticatorSecret();
  const encrypted = sealSecret(secret);
  const token = db.transaction(() => {
    checkManagementFactor(account, password, code);
    db.delete(accountTokens).where(and(eq(accountTokens.userId, account.id), eq(accountTokens.purpose, "enroll"))).run();
    return issueToken(account, "enroll", 600, encrypted);
  });
  const key = base32Secret(secret);
  const uri = `otpauth://totp/${encodeURIComponent(`greCAPTCHA:${account.username}`)}?secret=${key}&issuer=greCAPTCHA&algorithm=SHA1&digits=6&period=30`;
  return { enrollmentToken: token, setupKey: key, qrCode: await QRCode.toDataURL(uri, { width: 240, margin: 2 }) };
}

export function finishEnrollment(account: Account, token: string, code: string) {
  const row = recordChallengeAttempt(token, "enroll");
  if (row.userId !== account.id || !row.payload) throw new Error(invalidToken);
  const step = matchingStep(openSecret(row.payload), code.trim());
  if (step === null) throw new Error("Invalid authenticator code. Check your device's clock and try again.");
  return db.transaction(() => {
    assertAccountVersion(account);
    consumeToken(token, "enroll");
    const issueBackupCodes = Boolean(account.mfaSecret) || !hasFactor(account);
    db.update(users).set({ mfaSecret: row.payload, mfaLastStep: step }).where(eq(users.id, account.id)).run();
    revokeAuthentication(account.id);
    const fresh = accountById(account.id);
    const codes = issueBackupCodes ? newBackupCodes(account.id) : [];
    return { codes, acknowledgementToken: codes.length ? issueToken(fresh, "backup-ack", 600) : undefined };
  });
}

export async function regenerateCodes(account: Account, password: string | SettingsGrant, code: Factor) {
  await checkManagementPassword(account, password);
  return db.transaction(() => {
    checkManagementFactor(account, password, code);
    if (!hasFactor(account)) throw new Error("Enroll a security method first.");
    revokeAuthentication(account.id);
    return { codes: newBackupCodes(account.id), acknowledgementToken: issueToken(accountById(account.id), "backup-ack", 600) };
  });
}

export function verifyLoginChallenge(token: string, code: Factor, remember: boolean, label: string) {
  const row = recordChallengeAttempt(token, "login");
  return db.transaction(() => {
    const account = accountById(row.userId);
    const method = consumeFactor(account, code);
    consumeToken(token, "login");
    let deviceToken: string | undefined;
    let trustedDeviceId: string | undefined;
    if (remember && method !== "backup") {
      deviceToken = randomToken();
      trustedDeviceId = randomUUID();
      const now = new Date();
      const createdAt = now.toISOString();
      db.insert(trustedDevices).values({ id: trustedDeviceId, tokenHash: secretHash(deviceToken), userId: account.id,
        authVersion: account.authVersion, label: label.slice(0, 160) || "Remembered browser", createdAt,
        lastUsedAt: createdAt, expiresAt: new Date(now.getTime() + DEVICE_SECONDS * 1000).toISOString() }).run();
    }
    return { account, deviceToken, trustedDeviceId };
  });
}

export function trustedBrowser(account: Account, token: string) {
  if (!token || !hasFactor(account)) return null;
  const device = db.select().from(trustedDevices).where(and(eq(trustedDevices.tokenHash, secretHash(token)),
    eq(trustedDevices.userId, account.id), eq(trustedDevices.authVersion, account.authVersion),
    gt(trustedDevices.expiresAt, new Date().toISOString()))).get();
  if (device) db.update(trustedDevices).set({ lastUsedAt: new Date().toISOString() }).where(eq(trustedDevices.id, device.id)).run();
  return device;
}

export async function limitEmail(request: Request, destination: string) {
  await enforceRateLimit(request, "account-email-ip", "", 5, 3600);
  await enforceRateLimit(request, "account-email-destination", destination, 3, 3600, true);
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

export async function requestEmail(account: Account, email: string, password: string, code: Factor) {
  email = normalizeEmail(email);
  mailConfiguration();
  await confirmPassword(account, password);
  const token = db.transaction(() => {
    assertAccountVersion(account);
    if (hasFactor(account)) consumeFactor(account, code);
    if (db.select().from(users).where(eq(users.verifiedEmail, email)).get()) throw new Error("That email address is already in use.");
    return issueToken(account, "verify", 86400, email);
  });
  try { await sendAccountEmail(email, "verify", token); }
  catch (error) {
    db.delete(accountTokens).where(eq(accountTokens.tokenHash, secretHash(token))).run();
    throw error;
  }
}

export function verifyEmail(token: string) {
  return db.transaction(() => {
    const row = consumeToken(token, "verify");
    if (!row.payload) throw new Error(invalidToken);
    if (db.select().from(users).where(eq(users.verifiedEmail, row.payload)).get()) throw new Error("That email address is already in use. Choose a different address.");
    db.update(users).set({ verifiedEmail: row.payload }).where(eq(users.id, row.userId)).run();
    revokeAuthentication(row.userId);
  });
}

export async function requestPasswordReset(email: string, request?: Request) {
  mailConfiguration();
  const account = db.select().from(users).where(eq(users.verifiedEmail, normalizeEmail(email))).get();
  if (!account?.verifiedEmail) return;
  if (request) {
    try { await enforceRateLimit(request, "account-email-destination", account.verifiedEmail, 3, 3600, true); }
    catch { return; }
  }
  const token = issueToken(account, "reset", 1800);
  try { await sendAccountEmail(account.verifiedEmail, "reset", token); }
  catch {
    db.delete(accountTokens).where(eq(accountTokens.tokenHash, secretHash(token))).run();
    // Keep the public response identical for every account state. Delivery failure is logged by the mail transport.
  }
}

export async function resetPassword(token: string, password: string, code: Factor) {
  const row = recordChallengeAttempt(token, "reset");
  const fields = await passwordFields(password);
  db.transaction(() => {
    const current = consumeToken(token, "reset");
    const account = accountById(current.userId);
    if (row.userId !== account.id || !account.verifiedEmail) throw new Error(invalidToken);
    if (hasFactor(account)) consumeFactor(account, code);
    db.update(users).set(fields).where(eq(users.id, account.id)).run();
    revokeAuthentication(account.id);
  });
}
