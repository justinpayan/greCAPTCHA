import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";

const ENVELOPE_MAGIC = Buffer.from("RCENC001", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type StoredFileKind = "job-upload" | "manuscript" | "template-material";

/**
 * Production fails closed. Development and tests may opt out so local fixtures and Next's build
 * workers do not need the production secret. The Docker build sets DATA_ENCRYPTION_REQUIRED=false
 * for its build command only; the runtime image retains the secure production default.
 */
export function dataEncryptionRequired(): boolean {
  const configured = process.env.DATA_ENCRYPTION_REQUIRED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function dataEncryptionMasterKey(): Buffer | null {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (dataEncryptionRequired()) {
      throw new Error(
        "DATA_ENCRYPTION_KEY is required. Refusing to access persistent data without encryption.",
      );
    }
    return null;
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error("DATA_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64.");
  }
  return key;
}

export function deriveDataKey(purpose: string): Buffer | null {
  const master = dataEncryptionMasterKey();
  if (!master) return null;
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

function aad(kind: StoredFileKind): Buffer {
  return Buffer.from(`grecaptcha:${kind}:v1`, "utf8");
}

export function isEncryptedData(bytes: Uint8Array): boolean {
  const value = Buffer.from(bytes);
  return (
    value.length >= ENVELOPE_MAGIC.length &&
    value.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)
  );
}

export function encryptStoredBytes(bytes: Uint8Array, kind: StoredFileKind): Buffer {
  const key = deriveDataKey(`file:${kind}`);
  if (!key) return Buffer.from(bytes);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(kind));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([ENVELOPE_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptStoredBytes(bytes: Uint8Array, kind: StoredFileKind): Buffer {
  const value = Buffer.from(bytes);
  if (!isEncryptedData(value)) {
    if (dataEncryptionRequired()) {
      throw new Error(
        `Refusing to read an unencrypted ${kind} file while data encryption is required.`,
      );
    }
    return value;
  }
  const key = deriveDataKey(`file:${kind}`);
  if (!key) throw new Error(`DATA_ENCRYPTION_KEY is required to decrypt ${kind} data.`);
  const ivStart = ENVELOPE_MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  if (value.length < ciphertextStart) throw new Error(`Encrypted ${kind} file is truncated.`);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    value.subarray(ivStart, tagStart),
  );
  decipher.setAAD(aad(kind));
  decipher.setAuthTag(value.subarray(tagStart, ciphertextStart));
  return Buffer.concat([
    decipher.update(value.subarray(ciphertextStart)),
    decipher.final(),
  ]);
}

export function readEncryptedFile(filePath: string, kind: StoredFileKind): Buffer {
  return decryptStoredBytes(fs.readFileSync(filePath), kind);
}

/** Writes ciphertext atomically; no plaintext temporary file is created. */
export function writeEncryptedFile(
  filePath: string,
  bytes: Uint8Array,
  kind: StoredFileKind,
): void {
  const staging = `${filePath}.partial`;
  fs.rmSync(staging, { force: true });
  try {
    fs.writeFileSync(staging, encryptStoredBytes(bytes, kind), { flag: "wx", mode: 0o600 });
    fs.renameSync(staging, filePath);
  } finally {
    fs.rmSync(staging, { force: true });
  }
}
