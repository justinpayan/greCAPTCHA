import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { vi } from "vitest";

const databasePath = path.resolve(process.cwd(), "data", "vitest.db");
process.env.DATABASE_URL = databasePath;
process.env.ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.NODE_ENV = "test";
process.env.JOB_CONCURRENCY = "2";

for (const suffix of ["", "-wal", "-shm", ".migrate.lock"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
fs.rmSync(path.join(path.dirname(databasePath), "job-uploads"), {
  recursive: true,
  force: true,
});

(globalThis as typeof globalThis & { __realFetch?: typeof fetch }).__realFetch = globalThis.fetch;
vi.stubGlobal("fetch", vi.fn(async () => {
  throw new Error("Unexpected network request in a mocked test.");
}));
