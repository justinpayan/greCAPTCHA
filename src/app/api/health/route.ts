import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Unauthenticated liveness probe. Every other endpoint answers 401 or 503 without a
 * session, which a health check would read as an outage, so this one is exempt in
 * middleware. It reports nothing about the study data.
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
