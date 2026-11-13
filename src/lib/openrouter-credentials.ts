import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";

import { db } from "@/db";
import { conferenceCredentials, openRouterCredentials } from "@/db/schema";
import { endpointById, OPENROUTER_ENDPOINT } from "@/lib/llm-endpoints";
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

/** Stored keys: one per creator and endpoint, so OpenRouter tests keep grading beside institution ones. */
const keyFor = (userId: string, endpoint: string) =>
  and(eq(openRouterCredentials.userId, userId), eq(openRouterCredentials.endpoint, endpoint));

/**
 * Stores a creator's key for an endpoint. An OpenRouter key must carry a spending limit and an
 * expiry; an institution key is stored with whatever its gateway reports (see
 * `validateInstitutionKey`), which may be neither.
 */
export async function saveOpenRouterCredential(
  userId: string,
  apiKey: string,
  endpoint: string = OPENROUTER_ENDPOINT,
) {
  const trimmed = apiKey.trim();
  const metadata = await validateOpenRouterKey(trimmed, { requireSafeguards: true, endpoint });
  if (endpoint === OPENROUTER_ENDPOINT && (metadata.limit === null || metadata.expiresAt === null)) {
    throw new OpenRouterError("The OpenRouter key is missing required safeguards.");
  }
  const encrypted = encrypt(trimmed);
  const now = new Date().toISOString();
  await db
    .insert(openRouterCredentials)
    .values({
      userId,
      endpoint,
      ...encrypted,
      label: metadata.label,
      spendingLimit: metadata.limit,
      limitRemaining: metadata.limitRemaining,
      expiresAt: metadata.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [openRouterCredentials.userId, openRouterCredentials.endpoint],
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
  return credentialStatus(userId, endpoint);
}

export async function credentialStatus(userId: string, endpoint: string = OPENROUTER_ENDPOINT) {
  const row = await db
    .select({
      spendingLimit: openRouterCredentials.spendingLimit,
      limitRemaining: openRouterCredentials.limitRemaining,
      expiresAt: openRouterCredentials.expiresAt,
      updatedAt: openRouterCredentials.updatedAt,
    })
    .from(openRouterCredentials)
    .where(keyFor(userId, endpoint))
    .get();
  return row ? { connected: true as const, ...row } : { connected: false as const };
}

export async function requireOpenRouterCredential(
  userId: string,
  endpoint: string = OPENROUTER_ENDPOINT,
) {
  const label = endpoint === OPENROUTER_ENDPOINT ? "OpenRouter" : endpointById(endpoint).label;
  const row = await db
    .select()
    .from(openRouterCredentials)
    .where(keyFor(userId, endpoint))
    .get();
  if (!row) throw new OpenRouterError(`The administrator has not connected a ${label} key.`);
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new OpenRouterError(`The administrator's ${label} key has expired.`);
  }
  return decrypt(row);
}

export async function deleteOpenRouterCredential(
  userId: string,
  endpoint: string = OPENROUTER_ENDPOINT,
) {
  await db.delete(openRouterCredentials).where(keyFor(userId, endpoint)).run();
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
