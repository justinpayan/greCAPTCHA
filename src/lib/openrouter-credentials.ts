import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq, lte } from "drizzle-orm";

import { db } from "@/db";
import { conferenceCredentials, openRouterCredentials } from "@/db/schema";
import { validateOpenRouterKey } from "@/lib/openrouter";
import { OpenRouterError } from "@/lib/openrouter-errors";

function encryptionKey() {
  const raw = process.env.OPENROUTER_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new OpenRouterError("OPENROUTER_CREDENTIAL_ENCRYPTION_KEY is not configured.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new OpenRouterError("OPENROUTER_CREDENTIAL_ENCRYPTION_KEY must be 32 random base64 bytes.");
  }
  return key;
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(row: { ciphertext: string; iv: string; authTag: string }) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(row.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function saveOpenRouterCredential(userId: string, apiKey: string) {
  const trimmed = apiKey.trim();
  const metadata = await validateOpenRouterKey(trimmed, { requireSafeguards: true });
  if (metadata.limit === null || metadata.expiresAt === null) {
    throw new OpenRouterError("The OpenRouter key is missing required safeguards.");
  }
  const encrypted = encrypt(trimmed);
  const now = new Date().toISOString();
  await db
    .insert(openRouterCredentials)
    .values({
      userId,
      ...encrypted,
      label: metadata.label,
      spendingLimit: metadata.limit,
      limitRemaining: metadata.limitRemaining,
      expiresAt: metadata.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: openRouterCredentials.userId,
      set: {
        ...encrypted,
        label: metadata.label,
        spendingLimit: metadata.limit,
        limitRemaining: metadata.limitRemaining,
        expiresAt: metadata.expiresAt,
        updatedAt: now,
      },
    })
    .run();
  return credentialStatus(userId);
}

export async function credentialStatus(userId: string) {
  const row = await db
    .select({
      spendingLimit: openRouterCredentials.spendingLimit,
      limitRemaining: openRouterCredentials.limitRemaining,
      expiresAt: openRouterCredentials.expiresAt,
      updatedAt: openRouterCredentials.updatedAt,
    })
    .from(openRouterCredentials)
    .where(eq(openRouterCredentials.userId, userId))
    .get();
  return row ? { connected: true as const, ...row } : { connected: false as const };
}

export async function requireOpenRouterCredential(userId: string) {
  const row = await db
    .select()
    .from(openRouterCredentials)
    .where(eq(openRouterCredentials.userId, userId))
    .get();
  if (!row) throw new OpenRouterError("The administrator has not connected an OpenRouter account.");
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new OpenRouterError("The administrator's OpenRouter key has expired.");
  }
  return decrypt(row);
}

export async function deleteOpenRouterCredential(userId: string) {
  await db
    .delete(openRouterCredentials)
    .where(eq(openRouterCredentials.userId, userId))
    .run();
}

export async function saveConferenceCredential(submissionId: string, apiKey: string) {
  const key = apiKey.trim();
  const metadata = await validateOpenRouterKey(key, { requireSafeguards: true });
  if (!metadata.expiresAt) throw new OpenRouterError("The OpenRouter key needs an expiration date.");
  const values = { ...encrypt(key), expiresAt: new Date(metadata.expiresAt).toISOString() };
  await db
    .insert(conferenceCredentials)
    .values({ submissionId, ...values })
    .onConflictDoUpdate({ target: conferenceCredentials.submissionId, set: values })
    .run();
}

export function requireConferenceCredential(submissionId: string) {
  const row = db
    .select()
    .from(conferenceCredentials)
    .where(eq(conferenceCredentials.submissionId, submissionId))
    .get();
  if (!row || Date.parse(row.expiresAt) <= Date.now()) {
    throw new OpenRouterError("Reconnect OpenRouter to continue with this assessment.");
  }
  return decrypt(row);
}

export function deleteConferenceCredential(submissionId: string) {
  db.delete(conferenceCredentials).where(eq(conferenceCredentials.submissionId, submissionId)).run();
}

export function deleteExpiredConferenceCredentials() {
  db.delete(conferenceCredentials)
    .where(lte(conferenceCredentials.expiresAt, new Date().toISOString()))
    .run();
}
