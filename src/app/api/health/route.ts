import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

import { db, databaseFile } from "@/db";

export const runtime = "nodejs";

/**
 * Unauthenticated liveness probe. Every other endpoint answers 401 or 503 without a
 * session, which a health check would read as an outage, so this one is exempt in
 * middleware. It reports nothing about the study data.
 */
export async function GET() {
  try {
    await db.run(sql`SELECT 1`);
    fs.accessSync(path.dirname(databaseFile), fs.constants.R_OK | fs.constants.W_OK);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
