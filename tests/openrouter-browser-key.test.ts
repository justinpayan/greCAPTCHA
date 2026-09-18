import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  disconnectBrowserOpenRouterKey,
  readBrowserOpenRouterKey,
  validateBrowserOpenRouterKey,
} from "@/lib/openrouter-browser-key";

const storageKey = "grecaptcha.openrouter.oauth-key";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("browser-managed OpenRouter keys", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("keeps a browser key scoped to its greCAPTCHA account and disconnects it", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ownerUsername: "alice",
        key: "sk-or-browser-secret",
        label: "greCAPTCHA",
        limit: 5,
        limitRemaining: 5,
        expiresAt: "2099-01-01T00:00:00Z",
        settingsUrl: "https://openrouter.ai/keys/hash",
      }),
    );
    expect(readBrowserOpenRouterKey("alice")?.key).toBe("sk-or-browser-secret");
    expect(readBrowserOpenRouterKey("bob")).toBeNull();
    disconnectBrowserOpenRouterKey();
    expect(readBrowserOpenRouterKey("alice")).toBeNull();
  });

  it("rejects browser keys without spending and expiration safeguards", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ownerUsername: "alice",
        key: "sk-or-unsafe",
        label: "unsafe",
        limit: 1,
        limitRemaining: 1,
        expiresAt: "2099-01-01T00:00:00Z",
        settingsUrl: "https://openrouter.ai/keys/hash",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/session") return Response.json({ username: "alice" });
        return Response.json({ data: { limit: null, expires_at: null } });
      }),
    );
    await expect(validateBrowserOpenRouterKey()).rejects.toThrow("spending limit");
  });
});
