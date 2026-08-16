import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { withMigrationLock } from "@/db/migration-lock";
import * as schema from "@/db/schema";

const databasePath = process.env.DATABASE_URL ?? "./data/research-captcha.db";
const absolutePath = path.resolve(process.cwd(), databasePath);

fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

const sqlite = new Database(absolutePath, { timeout: 15_000 });
sqlite.pragma("busy_timeout = 15000");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// `next build` imports this module from several worker processes at once. Both steps below
// need brief exclusive access to the database, so both run under one cross-process mutex.
withMigrationLock(absolutePath, () => {
  // Switching a freshly created database into WAL needs an exclusive lock, and returns
  // SQLITE_BUSY rather than waiting when another connection is mid-open.
  sqlite.pragma("journal_mode = WAL");
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
});
