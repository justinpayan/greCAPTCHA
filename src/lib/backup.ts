import "server-only";

import fs from "node:fs";
import path from "node:path";

import { databaseFile, snapshotDatabase } from "@/db";

/**
 * Backups of the application data: a loadable copy of the database, taken on a
 * timer and after every grading.
 *
 * Everything here is best-effort by design. A backup that fails must never take a participant's
 * session down with it — losing the last hour of backups is recoverable, losing a submission
 * mid-session is not — so failures are logged and swallowed at every call site.
 */

/** What set this backup off. Recorded in the folder name so the history reads as a story. */
export type BackupTrigger = "interval" | "grading" | "assessment-submitted" | "startup";

export type BackupOutcome =
  | { status: "disabled" }
  | { status: "done"; directory: string; files: number; pruned: number }
  | { status: "failed"; error: string };

const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_KEEP = 48;

/** Sidecars of a WAL database. Excluded: the snapshot already contains their committed content,
 *  and a copy taken alongside it would be both redundant and inconsistent with it. */
const SQLITE_SIDECAR = /\.db(-wal|-shm|\.migrate\.lock)$/;

/** `2026-08-24T17-40-00Z` — filesystem-safe and still sorts chronologically as text. */
function folderStamp(now: Date) {
  return now.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

/** Our own folders, and only ours: pruning must never touch anything else in the backup root. */
const BACKUP_FOLDER = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-(?:interval|grading|startup)$/;

function envInteger(name: string, fallback: number, minimum: number) {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minimum) {
    console.warn(`[backup] ${name}="${raw}" is not an integer >= ${minimum}; using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/** The configured destination, or null when backups are switched off by leaving it unset. */
export function backupRoot(): string | null {
  const configured = (process.env.BACKUP_DIR ?? "").trim();
  if (!configured) return null;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
}

export function backupIntervalMs(): number {
  return envInteger("BACKUP_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES, 1) * 60_000;
}

export function backupKeep(): number {
  return envInteger("BACKUP_KEEP", DEFAULT_KEEP, 1);
}

/**
 * Everything in the database folder that is not the database itself.
 *
 * "Copy the folder" is taken literally for these — whatever else lives beside the database is
 * copied byte for byte, directories included — with only the WAL sidecars held back, since the
 * snapshot supersedes them.
 */
function companionEntries(databaseFolder: string, backupDestination: string) {
  const databaseName = path.basename(databaseFile);
  return fs
    .readdirSync(databaseFolder, { withFileTypes: true })
    .filter((entry) => entry.name !== databaseName)
    .filter((entry) => !SQLITE_SIDECAR.test(entry.name))
    // A backup folder configured *inside* the data folder would otherwise be copied into itself,
    // each backup swallowing all its predecessors and growing without limit. Tested by containment
    // rather than equality, so a root nested further down (`data/backups/hourly`) is caught too.
    .filter((entry) => {
      const entryPath = path.join(databaseFolder, entry.name);
      return (
        entryPath !== backupDestination && !backupDestination.startsWith(entryPath + path.sep)
      );
    });
}

/**
 * Deletes the oldest backups beyond the retention window.
 *
 * Only folders this module created are considered, matched by name. Anything else the researcher
 * has put in the backup directory — notes, an earlier manual copy — is left alone: a routine
 * that deletes files is not one to be liberal about what it recognises.
 */
function prune(root: string, keep: number): number {
  const ours = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && BACKUP_FOLDER.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const doomed = ours.slice(0, Math.max(0, ours.length - keep));
  for (const name of doomed) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return doomed.length;
}

/**
 * Takes one backup: a consistent database snapshot and every companion file in its folder.
 *
 * Assembled in a `.partial` folder and renamed into place at the end, so an interrupted backup
 * leaves something obviously incomplete rather than a folder that looks finished, counts towards
 * the retention window, and is discovered to be half-empty on the day it is needed.
 */
async function writeBackup(trigger: BackupTrigger, now: Date): Promise<BackupOutcome> {
  const root = backupRoot();
  if (!root) return { status: "disabled" };

  const destination = path.join(root, `${folderStamp(now)}-${trigger}`);
  const staging = `${destination}.partial`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  let files = 0;
  try {
    await snapshotDatabase(path.join(staging, path.basename(databaseFile)));
    files += 1;

    const databaseFolder = path.dirname(databaseFile);
    for (const entry of companionEntries(databaseFolder, root)) {
      fs.cpSync(path.join(databaseFolder, entry.name), path.join(staging, entry.name), {
        recursive: true,
      });
      files += 1;
    }

    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(staging, destination);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  return { status: "done", directory: destination, files, pruned: prune(root, backupKeep()) };
}

/**
 * One backup at a time, with at most one more queued behind it.
 *
 * Grading finishes and the hourly timer fire independently, so two backups can be asked for at
 * once. They are serialised rather than dropped: a request that arrives mid-backup is answered by
 * a *fresh* run afterwards, because the one in flight may have snapshotted the database before
 * the writes that prompted the new request. Further requests while one is already queued
 * collapse into it — a third run would only repeat the second.
 */
let inFlight: Promise<BackupOutcome> | null = null;
let queued: Promise<BackupOutcome> | null = null;

export function runBackup(trigger: BackupTrigger): Promise<BackupOutcome> {
  if (!backupRoot()) return Promise.resolve({ status: "disabled" });

  if (!inFlight) {
    inFlight = attempt(trigger).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }
  if (queued) return queued;
  queued = inFlight
    .catch(() => undefined)
    .then(() => {
      queued = null;
      return runBackup(trigger);
    });
  return queued;
}

/** Runs a backup and reports the result, converting a failure into an outcome rather than a throw. */
async function attempt(trigger: BackupTrigger): Promise<BackupOutcome> {
  const startedAt = Date.now();
  try {
    const outcome = await writeBackup(trigger, new Date());
    if (outcome.status === "done") {
      const pruned = outcome.pruned ? `, pruned ${outcome.pruned}` : "";
      console.log(
        `[backup] ${trigger}: ${outcome.files} files to ${outcome.directory} in ${Date.now() - startedAt}ms${pruned}`,
      );
    }
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[backup] ${trigger} failed: ${message}`);
    return { status: "failed", error: message };
  }
}

/**
 * Fire-and-forget backup for call sites that must not wait, above all grading.
 *
 * A participant who has just finished should see their result immediately; a backup taking a
 * second is not their problem. `attempt` already swallows failures, so this cannot produce an
 * unhandled rejection.
 */
export function backupInBackground(trigger: BackupTrigger): void {
  void runBackup(trigger);
}
