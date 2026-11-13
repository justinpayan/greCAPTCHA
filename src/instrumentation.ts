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
    // A malformed endpoint configuration stops the server here, at deploy, rather than sending
    // someone's tests to the wrong place later.
    const { endpointGroups } = await import("@/lib/llm-endpoints");
    let groups: ReturnType<typeof endpointGroups>;
    try {
      groups = endpointGroups();
    } catch (error) {
      // Exits rather than leaving a server that answers nothing, so the deploy visibly fails.
      console.error(`[endpoints] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    const { endpoints, groupByUser } = groups;
    if (endpoints.size) {
      console.log(
        `[endpoints] ${endpoints.size} institution endpoint(s) for ${groupByUser.size} user(s): ${[
          ...endpoints.keys(),
        ].join(", ")}`,
      );
    }

    const { startJobWorker } = await import("@/lib/jobs");
    await startJobWorker();
    const { startProctoringWorker } = await import("@/lib/proctoring");
    startProctoringWorker();

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
