import fs from "node:fs";

/**
 * Cross-process mutex for schema migrations.
 *
 * Migrations run when `@/db` is first imported, and `next build` collects page data in
 * several worker processes at once. Each worker opens its own connection, and because
 * WAL lets readers run alongside writers they all read the same "last applied migration"
 * row, all conclude the newest migration is pending, and all try to apply it. One wins;
 * the rest fail with `duplicate column name` and take the build down with them.
 *
 * Serializing the whole migrate() call fixes it: drizzle re-reads its bookkeeping table
 * inside the call, so whoever acquires the lock second sees the work already done and
 * does nothing.
 */

const ACQUIRE_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 60_000;
const POLL_INTERVAL_MS = 50;

/** Blocks the thread. Only ever called during module initialisation, before serving. */
function sleepSync(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockAgeMs(lockPath: string) {
  const stats = fs.statSync(lockPath, { throwIfNoEntry: false });
  return stats ? Date.now() - stats.mtimeMs : Number.POSITIVE_INFINITY;
}

export function withMigrationLock<T>(databasePath: string, run: () => T): T {
  const lockPath = `${databasePath}.migrate.lock`;
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  let handle: number | undefined;

  while (handle === undefined) {
    try {
      // "wx" is O_CREAT|O_EXCL: exactly one process can win this, atomically.
      handle = fs.openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      // A process killed mid-migration would otherwise block every later start.
      if (lockAgeMs(lockPath) > STALE_LOCK_MS) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the migration lock at ${lockPath}. Remove it if no migration is running.`,
        );
      }
      sleepSync(POLL_INTERVAL_MS);
    }
  }

  try {
    fs.writeSync(handle, `${process.pid}`);
    return run();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
}
