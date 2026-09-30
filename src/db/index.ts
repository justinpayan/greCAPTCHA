import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { withMigrationLock } from "@/db/migration-lock";
import * as schema from "@/db/schema";
import { deriveDataKey } from "@/lib/data-encryption";

const databasePath = process.env.DATABASE_URL ?? "./data/research-captcha.db";
const absolutePath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), databasePath);

fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

const sqlite = new Database(absolutePath, { timeout: 15_000 });
const encryptedSqlite = sqlite as typeof sqlite & {
  key(value: Buffer): number;
  rekey(value: Buffer): number;
};
const databaseKey = deriveDataKey("database");
if (databaseKey) {
  sqlite.pragma("cipher = 'sqlcipher'");
  sqlite.pragma("legacy = 4");
  encryptedSqlite.key(databaseKey);
  try {
    sqlite.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch (error) {
    sqlite.close();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to open the encrypted database. DATA_ENCRYPTION_KEY may be incorrect, or the database still needs the encryption migration. ${reason}`,
    );
  }
}
sqlite.pragma("busy_timeout = 15000");
// Keep sort/join spill data out of plaintext OS temporary files.
sqlite.pragma("temp_store = MEMORY");

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
  const backupKey = deriveDataKey("database-backup");
  if (!backupKey) return sqlite.backup(destination);
  // SQLite3MultipleCiphers preserves the source encryption when VACUUM writes to a normal path.
  // URI filenames are not accepted by VACUUM on Windows, so create the consistent snapshot with
  // the live database key and then rotate that still-encrypted file to the backup-specific key.
  sqlite.prepare("VACUUM INTO ?").run(path.resolve(destination));
  const backup = new Database(destination) as Database.Database & {
    key(value: Buffer): number;
    rekey(value: Buffer): number;
  };
  try {
    backup.pragma("cipher = 'sqlcipher'");
    backup.pragma("legacy = 4");
    backup.key(databaseKey!);
    backup.prepare("SELECT count(*) FROM sqlite_master").get();
    backup.rekey(backupKey);
  } finally {
    backup.close();
  }
  return Promise.resolve({ remainingPages: 0, totalPages: 0 });
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
