import "server-only";

import { createHash } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { rateLimits } from "@/db/schema";

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many requests. Try again later.");
  }
}

function clientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function opaqueKey(parts: string[]) {
  const salt =
    process.env.RATE_LIMIT_SALT?.trim() ||
    process.env.ACCOUNT_ENCRYPTION_KEY?.trim() ||
    "development-only";
  return createHash("sha256").update([salt, ...parts].join("\0")).digest("hex");
}

export async function enforceRateLimit(
  request: Request,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  const key = opaqueKey([scope, clientAddress(request), identifier.trim().toLowerCase()]);
  await db
    .insert(rateLimits)
    .values({ key, windowStartedAt: now.toISOString(), count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStartedAt} < ${cutoff} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${rateLimits.windowStartedAt} < ${cutoff} THEN ${now.toISOString()} ELSE ${rateLimits.windowStartedAt} END`,
      },
    })
    .run();
  const row = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
  if (row && row.count > limit) {
    const elapsed = now.getTime() - new Date(row.windowStartedAt).getTime();
    throw new RateLimitError(Math.max(1, Math.ceil(windowSeconds - elapsed / 1000)));
  }
  if (Math.random() < 0.01) {
    await db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStartedAt, new Date(now.getTime() - 7 * 86_400_000).toISOString()))
      .run();
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (process.env.NODE_ENV === "production") throw new Error("Missing request origin.");
    return;
  }
  const host = request.headers.get("host");
  if (!host) throw new Error("Missing request host.");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.startsWith("localhost") ? "http" : "https");
  if (origin !== `${protocol}://${host}`) throw new Error("Cross-origin request rejected.");
}

export function rateLimitResponse(error: RateLimitError) {
  return Response.json(
    { error: error.message },
    { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
  );
}
