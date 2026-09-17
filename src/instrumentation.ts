/**
 * Starts the backup timer when the server starts.
 *
 * Next calls `register()` once per server process, which is the only hook this app has for
 * "run something for the lifetime of the server" — there is no cron here, and the machine
 * serving a session is a laptop rather than something with a scheduler pointed at it.
 */
export async function register() {
  // This file can be compiled for non-Node runtimes as well, while the app's proxy and
  // nothing below can exist there: no filesystem, and `better-sqlite3` is a native module.
  // The check is written as a block rather than an early return so that Next's compile-time
  // substitution of NEXT_RUNTIME leaves `if (false) { … }` behind, and the import is dropped
  // from the Edge bundle instead of failing to resolve in it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobWorker } = await import("@/lib/jobs");
    await startJobWorker();

    const { backupIntervalMs, backupKeep, backupRoot, runBackup } = await import("@/lib/backup");

    const root = backupRoot();
    if (!root) {
      console.log("[backup] BACKUP_DIR is not set, so no backups will be taken.");
    } else {
      const intervalMs = backupIntervalMs();
      console.log(
        `[backup] every ${Math.round(intervalMs / 60_000)} min to ${root}, keeping ${backupKeep()}`,
      );
      void runBackup("startup");
      const timer = setInterval(() => void runBackup("interval"), intervalMs);
      timer.unref();
    }
  }
}
