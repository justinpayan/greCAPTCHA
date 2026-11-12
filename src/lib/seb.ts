import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";

import { db } from "@/db";
import { attempts, conferenceSubmissions } from "@/db/schema";

export const SEB_COOKIE = "__Host-rc_seb";
export const SEB_START_PATH = "/seb/start";
export const SEB_QUIT_PATH = "/seb/quit";

export function sebOrigin() {
  const value = process.env.SEB_PUBLIC_ORIGIN;
  if (!value) throw new Error("Safe Exam Browser is unavailable.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value) {
    throw new Error("Safe Exam Browser requires a configured HTTPS origin.");
  }
  return url.origin;
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newSebSecret() {
  return randomBytes(24).toString("base64url");
}

export function verifySeb(request: Request) {
  return sebVerificationError(request) === null;
}

export function sebVerificationError(request: Request): "missing-proof" | "invalid-proof" | "configuration" | "key-mismatch" | null {
  const proof = request.headers.get("x-safeexambrowser-requesthash") ?? "";
  if (!proof) return "missing-proof";
  if (!/^[a-f0-9]{64}$/i.test(proof)) return "invalid-proof";
  const keys = (process.env.SEB_BROWSER_EXAM_KEYS ?? "").split(",").map(value => value.trim())
    .filter(key => /^[a-f0-9]{64}$/i.test(key));
  if (!keys.length) return "configuration";
  const url = new URL(request.url);
  let origin: string;
  try { origin = sebOrigin(); } catch { return "configuration"; }
  const exactUrl = origin + url.pathname + url.search;
  return keys.some((key) => {
    return timingSafeEqual(
      Buffer.from(proof, "hex"),
      Buffer.from(hashSecret(exactUrl + key), "hex"),
    );
  }) ? null : "key-mismatch";
}

export function proctoredAttempt(attemptId: string) {
  return db.select().from(conferenceSubmissions).where(and(
    eq(conferenceSubmissions.attemptId, attemptId),
    eq(conferenceSubmissions.requireSeb, true),
  )).get();
}

export async function verifiedSebSession(attemptId: string, request: Request) {
  if (!verifySeb(request)) return undefined;
  return sebPageSession(attemptId);
}

export async function sebPageSession(attemptId: string) {
  const token = (await cookies()).get(SEB_COOKIE)?.value;
  if (!token) return undefined;
  const row = db.select({ submission: conferenceSubmissions }).from(conferenceSubmissions)
    .innerJoin(attempts, and(
      eq(attempts.id, conferenceSubmissions.attemptId),
      eq(attempts.takerUserId, conferenceSubmissions.takerUserId),
    )).where(and(
    eq(conferenceSubmissions.attemptId, attemptId),
    eq(conferenceSubmissions.requireSeb, true),
    eq(conferenceSubmissions.sebSessionHash, hashSecret(token)),
    gt(conferenceSubmissions.sebSessionExpiresAt, Date.now()),
  )).get();
  return row?.submission;
}

export async function sebRequest() {
  const incoming = await headers();
  const path = incoming.get("x-rc-request-path");
  if (!path?.startsWith("/") || path.startsWith("//")) throw new Error("Safe Exam Browser is required.");
  return new Request(sebOrigin() + path, { headers: incoming });
}

export function redeemSebLaunch(token: string) {
  return db.transaction((tx) => {
    const now = Date.now();
    const where = and(eq(conferenceSubmissions.launchHash, hashSecret(token)),
      gt(conferenceSubmissions.launchExpiresAt, now), eq(conferenceSubmissions.requireSeb, true));
    const submission = tx.select().from(conferenceSubmissions).where(where).get();
    if (!submission?.attemptId) return undefined;
    const attempt = tx.select().from(attempts).where(eq(attempts.id, submission.attemptId)).get();
    if (attempt?.takerUserId !== submission.takerUserId) return undefined;
    const session = newSebSecret();
    tx.update(conferenceSubmissions).set({
      launchHash: null,
      launchExpiresAt: null,
      sebSessionHash: hashSecret(session),
      sebSessionExpiresAt: now + 12 * 60 * 60_000,
    }).where(where).run();
    return { attemptId: submission.attemptId, session };
  }, { behavior: "immediate" });
}
