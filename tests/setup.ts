import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

// A folder of its own, not `data/` itself: manuscripts and job uploads are stored beside the
// database, and the cleanup below would otherwise delete the local app's files too.
const databasePath = path.resolve(process.cwd(), "data", "vitest", "vitest.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
process.env.DATABASE_URL = databasePath;
process.env.JOB_CONCURRENCY = "2";
process.env.OPENROUTER_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

for (const suffix of ["", "-wal", "-shm", ".migrate.lock"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
fs.rmSync(path.join(path.dirname(databasePath), "job-uploads"), {
  recursive: true,
  force: true,
});
fs.rmSync(path.join(path.dirname(databasePath), "manuscripts"), {
  recursive: true,
  force: true,
});

(globalThis as typeof globalThis & { __realFetch?: typeof fetch }).__realFetch = globalThis.fetch;
vi.stubGlobal("fetch", vi.fn(async () => {
  throw new Error("Unexpected network request in a mocked test.");
}));
