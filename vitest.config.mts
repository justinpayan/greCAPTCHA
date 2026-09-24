import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/server-only.ts"),
    },
  },
  server: {
    watch: {
      // Integration tests intentionally create SQLite files, temporary job uploads, and
      // manuscript .partial files. Watching runtime data can raise EBUSY on Windows while a
      // file is being atomically replaced, and none of these files should trigger a test rerun.
      ignored: ["**/data/**"],
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
