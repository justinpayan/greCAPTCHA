import "server-only";
import { createHmac } from "node:crypto";
import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { passkeys, backupCodes, users } from "@/db/schema";
import { deriveDataKey } from "@/lib/data-encryption";
import { type Account, type Factor, VerifiedPasskey, type SettingsGrant, checkManagementPassword, checkManagementFactor, hasFactor, consumeToken, issueToken, recordChallengeAttempt, newBackupCodes, revokeAuthentication, accountById } from "./account-security";

function relyingParty() {
  const url = new URL(process.env.PUBLIC_BASE_URL || "");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Passkeys require HTTPS or local development on localhost.");
  }
  return { expectedOrigin: url.origin, expectedRPID: url.hostname };
}

export function listedKeys(userId: string) {
  return db.select({ id: passkeys.id, name: passkeys.name }).from(passkeys).where(eq(passkeys.userId, userId)).all();
}

export function operationBinding(action: string, context: string, body: Record<string, unknown>) {
  const key = deriveDataKey("passkey-action");
  if (!key) throw new Error("Configure account encryption before using passkeys.");
  return createHmac("sha256", key).update(JSON.stringify([action, context, body.email, body.password, body.confirmation, body.deviceId, body.keyId, body.name, body.remember])).digest("hex");
}

export async function assertionOptions(account: Account, binding: string) {
  const keys = listedKeys(account.id);
  if (!keys.length) throw new Error("No passkey is enrolled. Use an authenticator or backup code.");
  const options = await generateAuthenticationOptions({ rpID: relyingParty().expectedRPID, userVerification: "required", allowCredentials: keys.map(({ id }) => ({ id })) });
  return { options, ticket: issueToken(account, "assert:" + binding, 600, options.challenge) };
}

export async function verifyAssertion(account: Account, binding: string, ticket: string, response: AuthenticationResponseJSON) {
  const purpose = "assert:" + binding;
  const row = recordChallengeAttempt(ticket, purpose);
  const key = db.select().from(passkeys).where(and(eq(passkeys.userId, account.id), eq(passkeys.id, response.id))).get();
  if (!key || row.userId !== account.id) throw new Error("Passkey verification failed.");
  const result = await verifyAuthenticationResponse({ response, ...relyingParty(), expectedChallenge: row.payload!, requireUserVerification: true,
    credential: { id: key.id, publicKey: Uint8Array.from(Buffer.from(key.publicKey, "base64url")), counter: key.counter } });
  if (!result.verified) throw new Error("Passkey verification failed.");
  return db.transaction(() => {
    consumeToken(ticket, purpose);
    const updated = db.update(passkeys).set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() })
      .where(and(eq(passkeys.id, key.id), eq(passkeys.counter, key.counter))).run();
    if (!updated.changes) throw new Error("Please try verifying again.");
    return new VerifiedPasskey(account.id, account.authVersion);
  });
}

export async function startKey(account: Account, password: string | SettingsGrant, factor: Factor, name: string) {
  name = name.trim();
  if (!name || name.length > 80) throw new Error("Enter a passkey name of up to 80 characters.");
  await checkManagementPassword(account, password);
  const options = await generateRegistrationOptions({ rpName: "greCAPTCHA", rpID: relyingParty().expectedRPID, userID: new TextEncoder().encode(account.id), userName: account.username,
    authenticatorSelection: { userVerification: "required", residentKey: "preferred" }, excludeCredentials: listedKeys(account.id).map(({ id }) => ({ id })) });
  return db.transaction(() => {
    checkManagementFactor(account, password, factor);
    return { options, ticket: issueToken(account, "register-passkey", 600, JSON.stringify({ challenge: options.challenge, name })) };
  });
}

export async function finishKey(account: Account, ticket: string, response: RegistrationResponseJSON) {
  const row = recordChallengeAttempt(ticket, "register-passkey");
  if (row.userId !== account.id) throw new Error("Passkey enrollment expired.");
  const { challenge, name } = JSON.parse(row.payload!);
  const result = await verifyRegistrationResponse({ response, ...relyingParty(), expectedChallenge: challenge, requireUserVerification: true });
  if (!result.verified || !result.registrationInfo) throw new Error("Passkey registration failed.");
  const credential = result.registrationInfo.credential;
  return db.transaction(() => {
    consumeToken(ticket, "register-passkey");
    const first = !hasFactor(account);
    db.insert(passkeys).values({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, name, userId: account.id, createdAt: new Date().toISOString() }).run();
    revokeAuthentication(account.id);
    return first ? { codes: newBackupCodes(account.id), acknowledgementToken: issueToken(accountById(account.id), "backup-ack", 600) } : { signIn: true };
  });
}

export async function removeMethod(account: Account, password: string | SettingsGrant, factor: Factor, keyId?: string) {
  await checkManagementPassword(account, password);
  db.transaction(() => {
    checkManagementFactor(account, password, factor);
    if (keyId === undefined) {
      db.update(users).set({ mfaSecret: null, mfaLastStep: -1 }).where(eq(users.id, account.id)).run();
    } else if (!db.delete(passkeys).where(and(eq(passkeys.id, keyId), eq(passkeys.userId, account.id))).run().changes) {
      throw new Error("Passkey not found.");
    }
    revokeAuthentication(account.id);
    if (!hasFactor(accountById(account.id))) db.delete(backupCodes).where(eq(backupCodes.userId, account.id)).run();
  });
}
