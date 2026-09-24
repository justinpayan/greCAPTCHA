import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeOpenRouterOAuth,
  disconnectBrowserOpenRouterKey,
  readBrowserOpenRouterKey,
  validateBrowserOpenRouterKey,
} from "@/lib/openrouter-browser-key";

const storageKey = "grecaptcha.openrouter.oauth-key";
const flowStorageKey = "grecaptcha.openrouter.pkce-flow";

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
    vi.stubGlobal("sessionStorage", memoryStorage());
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

  it("sends a professor PKCE key to encrypted server storage without retaining it locally", async () => {
    sessionStorage.setItem(
      flowStorageKey,
      JSON.stringify({
        verifier: "test-verifier",
        nonce: "test-nonce",
        username: "alice",
        storage: "server",
        createdAt: Date.now(),
      }),
    );
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://example.test/?openrouter_oauth=test-nonce&code=authorization-code",
      },
      history: { replaceState, state: null },
      dispatchEvent,
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/session") return Response.json({ username: "alice" });
      if (url === "https://openrouter.ai/api/v1/auth/keys") {
        return Response.json({ key: "sk-or-professor-secret" });
      }
      if (url === "https://openrouter.ai/api/v1/key") {
        return Response.json({
          data: {
            label: "Professor key",
            limit: 5,
            limit_remaining: 5,
            expires_at: "2099-01-01T00:00:00Z",
          },
        });
      }
      if (url === "/api/openrouter/credential") {
        expect(JSON.parse(String(init?.body))).toEqual({
          openrouterApiKey: "sk-or-professor-secret",
        });
        return Response.json({ connected: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeOpenRouterOAuth()).resolves.toEqual({ serverStored: true });
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(sessionStorage.getItem(flowStorageKey)).toBeNull();
    expect(replaceState).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalled();
  });
});
