import { hkdfSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function masterKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("Set DATA_ENCRYPTION_KEY before restoring a backup.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error("DATA_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64.");
  }
  return key;
}

const master = masterKey();
function derive(purpose) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      master,
      Buffer.from("grecaptcha-data-encryption-v1", "utf8"),
      Buffer.from(purpose, "utf8"),
      32,
    ),
  );
}

function configure(database, key) {
  database.pragma("cipher = 'sqlcipher'");
  database.pragma("legacy = 4");
  database.key(key);
  database.prepare("SELECT count(*) FROM sqlite_master").get();
  const result = database.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`Database integrity check failed: ${String(result)}`);
}

const backupArgument = process.argv[2];
if (!backupArgument) {
  throw new Error("Usage: npm run data:restore -- <encrypted-backup-directory>");
}
const backupDirectory = path.resolve(process.cwd(), backupArgument);
const databasePath = path.resolve(
  process.cwd(),
  process.env.DATABASE_URL ?? "./data/research-captcha.db",
);
const dataRoot = path.dirname(databasePath);
const backupDatabase = path.join(backupDirectory, path.basename(databasePath));
if (!fs.existsSync(backupDatabase)) {
  throw new Error(`Encrypted backup database not found: ${backupDatabase}`);
}

const lockPath = path.join(dataRoot, ".encryption-migration.lock");
fs.mkdirSync(dataRoot, { recursive: true });
const lock = fs.openSync(lockPath, "wx", 0o600);
const staging = `${databasePath}.restoring`;
const rollback = path.join(
  dataRoot,
  `restore-rollback-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
let swapStarted = false;

try {
  fs.rmSync(staging, { force: true });
  const source = new Database(backupDatabase, { readonly: true });
  try {
    configure(source, derive("database-backup"));
    // VACUUM preserves the source cipher and key. Use a normal path because SQLite does not
    // accept VACUUM URI filenames on Windows, then rotate the encrypted copy to the live key.
    source.prepare("VACUUM INTO ?").run(staging);
  } finally {
    source.close();
  }

  const verified = new Database(staging);
  try {
    configure(verified, derive("database-backup"));
    verified.rekey(derive("database"));
    verified.prepare("SELECT count(*) FROM sqlite_master").get();
  } finally {
    verified.close();
  }

  fs.mkdirSync(rollback, { recursive: true, mode: 0o700 });
  swapStarted = true;
  for (const suffix of ["", "-wal", "-shm"]) {
    const current = `${databasePath}${suffix}`;
    if (fs.existsSync(current)) {
      fs.renameSync(current, path.join(rollback, path.basename(current)));
    }
  }
  fs.renameSync(staging, databasePath);
  for (const directory of ["manuscripts", "template-materials", "job-uploads"]) {
    const current = path.join(dataRoot, directory);
    if (fs.existsSync(current)) fs.renameSync(current, path.join(rollback, directory));
    const saved = path.join(backupDirectory, directory);
    if (fs.existsSync(saved)) fs.cpSync(saved, current, { recursive: true });
  }
  console.log(
    `Encrypted backup restored. Previous encrypted data remains at ${rollback}; remove it after verification.`,
  );
} catch (error) {
  if (swapStarted && fs.existsSync(rollback)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const current = `${databasePath}${suffix}`;
      const previous = path.join(rollback, path.basename(current));
      fs.rmSync(current, { force: true });
      if (fs.existsSync(previous)) fs.renameSync(previous, current);
    }
    for (const directory of ["manuscripts", "template-materials", "job-uploads"]) {
      const current = path.join(dataRoot, directory);
      const previous = path.join(rollback, directory);
      fs.rmSync(current, { recursive: true, force: true });
      if (fs.existsSync(previous)) fs.renameSync(previous, current);
    }
  }
  throw error;
} finally {
  fs.rmSync(staging, { force: true });
  fs.closeSync(lock);
  fs.rmSync(lockPath, { force: true });
}
