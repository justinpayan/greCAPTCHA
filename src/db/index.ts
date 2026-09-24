import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { withMigrationLock } from "@/db/migration-lock";
import * as schema from "@/db/schema";

const databasePath = process.env.DATABASE_URL ?? "./data/research-captcha.db";
const absolutePath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), databasePath);

fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

const sqlite = new Database(absolutePath, { timeout: 15_000 });
sqlite.pragma("busy_timeout = 15000");

export const db = drizzle(sqlite, { schema });

/** Where the database lives, so a backup can find the folder holding it. */
export const databaseFile = absolutePath;

/**
 * Writes a consistent copy of the database to `destination`, via SQLite's online backup API.
 *
 * The reason a backup cannot simply copy the file: this connection runs in WAL mode, so recent
 * commits live in the `-wal` sidecar until a checkpoint folds them in. Copying the `.db` alone
 * would silently lose them, and copying the pair while a write is in flight can capture two files
 * that disagree. The backup API takes a proper read lock and produces one self-contained file with
 * every committed transaction in it, without blocking writers for the duration.
 *
 * The raw connection stays private to this module — callers get the operation, not the handle.
 */
export function snapshotDatabase(destination: string): Promise<unknown> {
  return sqlite.backup(destination);
}

// `next build` imports this module from several worker processes at once. Every step below
// needs brief exclusive access to the database, so they run under one cross-process mutex.
withMigrationLock(absolutePath, () => {
  // Switching a freshly created database into WAL needs an exclusive lock, and returns
  // SQLITE_BUSY rather than waiting when another connection is mid-open.
  sqlite.pragma("journal_mode = WAL");

  // SQLite table-rebuild migrations may temporarily violate references, and the pragma cannot be
  // changed from inside the transaction used by the migrator.
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }

  // Enforcement being off is exactly when a bad migration could leave a dangling reference, so
  // the run is not trusted on its word.
  const dangling = sqlite.pragma("foreign_key_check") as unknown[];
  if (dangling.length > 0) {
    throw new Error(
      `Migrations left ${dangling.length} dangling foreign-key reference(s); the database was not migrated cleanly.`,
    );
  }
});
