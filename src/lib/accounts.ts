import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users, type UserRecord } from "@/db/schema";
import { validateOpenRouterKey } from "@/lib/openrouter";

const SCRYPT_KEY_LENGTH = 64;

function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().toLowerCase();
}

function validateUsername(username: string) {
  const trimmed = username.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(trimmed)) {
    throw new Error("Username must be 3–32 characters using letters, numbers, ., _, or -.");
  }
  return trimmed;
}

function validatePassword(password: string) {
  if (password.length < 10) throw new Error("Password must be at least 10 characters.");
  if (password.length > 200) throw new Error("Password is too long.");
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function encryptionKey() {
  const raw = process.env.ACCOUNT_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ACCOUNT_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ACCOUNT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function encryptApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptApiKey(user: Pick<UserRecord, "openrouterKeyCiphertext" | "openrouterKeyIv" | "openrouterKeyTag">) {
  if (!user.openrouterKeyCiphertext || !user.openrouterKeyIv || !user.openrouterKeyTag) {
    throw new Error("Add an OpenRouter API key to generate or grade question sets.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(user.openrouterKeyIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(user.openrouterKeyTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(user.openrouterKeyCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function registerAccount(input: {
  username: string;
  password: string;
  openrouterApiKey?: string;
}) {
  const username = validateUsername(input.username);
  validatePassword(input.password);
  const apiKey = input.openrouterApiKey?.trim() ?? "";
  if (apiKey.length > 512) throw new Error("Enter a valid OpenRouter API key.");
  if (apiKey) await validateOpenRouterKey(apiKey);

  const salt = randomBytes(16);
  const passwordHash = await scrypt(input.password, salt);
  const encrypted = apiKey ? encryptApiKey(apiKey) : null;
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    username,
    usernameNormalized: normalizeUsername(username),
    passwordHash: passwordHash.toString("base64"),
    passwordSalt: salt.toString("base64"),
    openrouterKeyCiphertext: encrypted?.ciphertext ?? null,
    openrouterKeyIv: encrypted?.iv ?? null,
    openrouterKeyTag: encrypted?.tag ?? null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.insert(users).values(user).run();
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      throw new Error("That username is already taken.");
    }
    throw error;
  }
  return user;
}

export async function authenticateAccount(username: string, password: string) {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.usernameNormalized, normalizeUsername(username)))
    .get();
  if (!user) {
    await scrypt(password || "invalid", randomBytes(16));
    return null;
  }
  const actual = await scrypt(password, Buffer.from(user.passwordSalt, "base64"));
  const expected = Buffer.from(user.passwordHash, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? user : null;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAccountSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
  await db.insert(sessions).values({
    tokenHash: tokenHash(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return token;
}

export async function accountForSession(token: string) {
  if (!token) return null;
  const row = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date().toISOString())))
    .get();
  return row?.user ?? null;
}

export async function deleteAccountSession(token: string) {
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token))).run();
}

export async function getUserOpenRouterKey(userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error("Account not found.");
  return decryptApiKey(user);
}

export async function updateUserOpenRouterKey(userId: string, apiKey: string) {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length > 512) throw new Error("Enter a valid OpenRouter API key.");
  await validateOpenRouterKey(trimmed);
  const encrypted = encryptApiKey(trimmed);
  await db
    .update(users)
    .set({
      openrouterKeyCiphertext: encrypted.ciphertext,
      openrouterKeyIv: encrypted.iv,
      openrouterKeyTag: encrypted.tag,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId))
    .run();
}
