import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const MAGIC = Buffer.from("RCENC001", "ascii");
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

function readKey(name, required = true) {
  const raw = process.env[name]?.trim();
  if (!raw && !required) return null;
  if (!raw) throw new Error(`Set ${name} before running this migration.`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error(`${name} must be exactly 32 random bytes encoded as base64.`);
  }
  return key;
}

const sourceMaster = readKey("DATA_ENCRYPTION_KEY");
const targetMaster = readKey("NEW_DATA_ENCRYPTION_KEY", false) ?? sourceMaster;

function derive(master, purpose) {
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

function isEncrypted(bytes) {
  return bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC);
}

function aad(kind) {
  return Buffer.from(`grecaptcha:${kind}:v1`, "utf8");
}

function encrypt(bytes, kind) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    derive(targetMaster, `file:${kind}`),
    iv,
  );
  cipher.setAAD(aad(kind));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(bytes, kind, master = sourceMaster) {
  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derive(master, `file:${kind}`),
    bytes.subarray(ivStart, tagStart),
  );
  decipher.setAAD(aad(kind));
  decipher.setAuthTag(bytes.subarray(tagStart, ciphertextStart));
  return Buffer.concat([decipher.update(bytes.subarray(ciphertextStart)), decipher.final()]);
}

function convertFile(filePath, kind) {
  const original = fs.readFileSync(filePath);
  let plaintext = original;
  if (isEncrypted(original)) {
    plaintext = decrypt(original, kind);
    if (sourceMaster.equals(targetMaster)) return false;
  }
  const encrypted = encrypt(plaintext, kind);
  const staging = `${filePath}.encrypting`;
  fs.rmSync(staging, { force: true });
  fs.writeFileSync(staging, encrypted, { flag: "wx", mode: 0o600 });
  const verified = decrypt(fs.readFileSync(staging), kind, targetMaster);
  if (!verified.equals(plaintext)) {
    fs.rmSync(staging, { force: true });
    throw new Error(`Verification failed while encrypting ${filePath}`);
  }
  fs.renameSync(staging, filePath);
  return true;
}

function configureCipher(database) {
  database.pragma("cipher = 'sqlcipher'");
  database.pragma("legacy = 4");
}

function verifyDatabase(database) {
  database.prepare("SELECT count(*) FROM sqlite_master").get();
  const result = database.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`Database integrity check failed: ${String(result)}`);
}

function convertDatabase(filePath, purpose) {
  const header = fs.readFileSync(filePath).subarray(0, SQLITE_HEADER.length);
  const database = new Database(filePath);
  try {
    configureCipher(database);
    if (header.equals(SQLITE_HEADER)) {
      database.rekey(derive(targetMaster, purpose));
    } else {
      database.key(derive(sourceMaster, purpose));
      verifyDatabase(database);
      if (!sourceMaster.equals(targetMaster)) {
        database.rekey(derive(targetMaster, purpose));
      }
    }
    verifyDatabase(database);
  } finally {
    database.close();
  }
  return header.equals(SQLITE_HEADER) || !sourceMaster.equals(targetMaster);
}

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(entryPath));
    else if (entry.isFile() && !entry.name.endsWith(".partial")) files.push(entryPath);
  }
  return files;
}

function kindForPath(filePath) {
  const parts = filePath.split(path.sep);
  if (parts.includes("manuscripts")) return "manuscript";
  if (parts.includes("template-materials")) return "template-material";
  if (parts.includes("job-uploads")) return "job-upload";
  return null;
}

const databasePath = path.resolve(
  process.cwd(),
  process.env.DATABASE_URL ?? "./data/research-captcha.db",
);
if (!fs.existsSync(databasePath)) {
  throw new Error(`Database does not exist: ${databasePath}`);
}
const dataRoot = path.dirname(databasePath);
const backupRoot = process.env.BACKUP_DIR
  ? path.resolve(process.cwd(), process.env.BACKUP_DIR)
  : null;
const lockPath = path.join(dataRoot, ".encryption-migration.lock");
fs.mkdirSync(dataRoot, { recursive: true });
const lock = fs.openSync(lockPath, "wx", 0o600);

try {
  const candidates = [
    databasePath,
    ...filesBelow(path.join(dataRoot, "manuscripts")),
    ...filesBelow(path.join(dataRoot, "template-materials")),
    ...filesBelow(path.join(dataRoot, "job-uploads")),
    ...(backupRoot ? filesBelow(backupRoot) : []),
  ];
  const requiredBytes = candidates.reduce(
    (total, filePath) => total + fs.statSync(filePath).size,
    0,
  );
  if (typeof fs.statfsSync === "function") {
    const stats = fs.statfsSync(dataRoot);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    if (availableBytes < requiredBytes * 2) {
      throw new Error(
        `Encryption migration needs about ${requiredBytes * 2} free bytes, but only ${availableBytes} are available.`,
      );
    }
  }

  let databases = 0;
  let files = 0;
  if (convertDatabase(databasePath, "database")) databases += 1;

  for (const filePath of candidates) {
    if (filePath === databasePath) continue;
    const relative = backupRoot ? path.relative(backupRoot, filePath) : "";
    if (
      backupRoot &&
      !relative.startsWith("..") &&
      path.basename(filePath) === path.basename(databasePath)
    ) {
      if (convertDatabase(filePath, "database-backup")) databases += 1;
      continue;
    }
    const kind = kindForPath(filePath);
    if (kind && convertFile(filePath, kind)) files += 1;
  }

  console.log(
    `${sourceMaster.equals(targetMaster) ? "Encryption migration" : "Encryption key rotation"} complete: ${databases} database file(s) and ${files} stored file(s) converted.`,
  );
} finally {
  fs.closeSync(lock);
  fs.rmSync(lockPath, { force: true });
}
