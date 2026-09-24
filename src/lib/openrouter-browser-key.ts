"use client";

export type KeySource = "paste" | "oauth";

export type BrowserOpenRouterKey = {
  ownerUsername: string;
  key: string;
  label: string | null;
  limit: number;
  limitRemaining: number | null;
  expiresAt: string;
  settingsUrl: string;
};

const KEY_STORAGE = "grecaptcha.openrouter.oauth-key";
const FLOW_STORAGE = "grecaptcha.openrouter.pkce-flow";

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function sha256Hex(value: string) {
  return Array.from(await sha256(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readBrowserOpenRouterKey(ownerUsername?: string): BrowserOpenRouterKey | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY_STORAGE) ?? "null") as BrowserOpenRouterKey;
    if (!parsed?.key || !parsed.expiresAt || !parsed.ownerUsername) return null;
    return ownerUsername && parsed.ownerUsername !== ownerUsername ? null : parsed;
  } catch {
    return null;
  }
}

export function disconnectBrowserOpenRouterKey() {
  localStorage.removeItem(KEY_STORAGE);
}

async function inspectKey(key: string, ownerUsername: string): Promise<BrowserOpenRouterKey> {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("OpenRouter rejected the browser-managed key.");
  const payload = (await response.json()) as {
    data?: {
      label?: string | null;
      limit?: number | null;
      limit_remaining?: number | null;
      expires_at?: string | null;
    };
  };
  const limit = payload.data?.limit;
  const expiresAt = payload.data?.expires_at;
  const settingsUrl = `https://openrouter.ai/keys/${await sha256Hex(key)}`;
  if (limit === null || limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Set a positive spending limit before using this key. Open its settings: ${settingsUrl}`);
  }
  if (!expiresAt) {
    throw new Error(`Set a future expiration date before using this key. Open its settings: ${settingsUrl}`);
  }
  const expiration = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiration) || expiration <= Date.now()) {
    throw new Error(`Set a future expiration date before using this key. Open its settings: ${settingsUrl}`);
  }
  const limitRemaining = payload.data?.limit_remaining ?? null;
  if (limitRemaining !== null && limitRemaining <= 0) {
    throw new Error(`This key has exhausted its spending limit. Open its settings: ${settingsUrl}`);
  }
  return {
    ownerUsername,
    key,
    label: payload.data?.label ?? null,
    limit,
    limitRemaining,
    expiresAt,
    settingsUrl,
  };
}

export async function validateBrowserOpenRouterKey() {
  const sessionResponse = await fetch("/api/session", { cache: "no-store" });
  const session = (await sessionResponse.json()) as { username?: string };
  if (!sessionResponse.ok || !session.username) throw new Error("Sign in to use this key.");
  const stored = readBrowserOpenRouterKey(session.username);
  if (!stored) throw new Error("Connect a browser-managed OpenRouter key first.");
  const inspected = await inspectKey(stored.key, session.username);
  localStorage.setItem(KEY_STORAGE, JSON.stringify(inspected));
  return inspected;
}

export async function beginOpenRouterOAuth(storage: "browser" | "server" = "browser") {
  const sessionResponse = await fetch("/api/session", { cache: "no-store" });
  const session = (await sessionResponse.json()) as { username?: string };
  if (!sessionResponse.ok || !session.username) {
    throw new Error("Sign in before connecting an OpenRouter key.");
  }
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(verifierBytes);
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64Url(await sha256(verifier));
  sessionStorage.setItem(
    FLOW_STORAGE,
    JSON.stringify({ verifier, nonce, username: session.username, storage, createdAt: Date.now() }),
  );
  const callback = new URL(window.location.origin + window.location.pathname);
  callback.searchParams.set("openrouter_oauth", nonce);
  const authorize = new URL("https://openrouter.ai/auth");
  authorize.searchParams.set("callback_url", callback.toString());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("key_label", "greCAPTCHA browser key");
  window.location.assign(authorize.toString());
}

export async function completeOpenRouterOAuth(): Promise<
  BrowserOpenRouterKey | { serverStored: true } | null
> {
  const url = new URL(window.location.href);
  const nonce = url.searchParams.get("openrouter_oauth");
  const code = url.searchParams.get("code");
  if (!nonce && !code) return null;
  url.searchParams.delete("openrouter_oauth");
  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, "", url.toString());

  const flowRaw = sessionStorage.getItem(FLOW_STORAGE);
  sessionStorage.removeItem(FLOW_STORAGE);
  if (!flowRaw || !code) throw new Error("The OpenRouter connection could not be verified.");
  const flow = JSON.parse(flowRaw) as {
    verifier?: string;
    nonce?: string;
    username?: string;
    storage?: "browser" | "server";
    createdAt?: number;
  };
  if (
    !flow.verifier ||
    // OpenRouter may rebuild the callback URL when appending `code`, dropping its existing
    // query string. When it preserves our nonce it must match; otherwise the authorization code
    // remains bound to this browser by the secret S256 verifier stored in sessionStorage.
    (nonce !== null && flow.nonce !== nonce) ||
    !flow.createdAt ||
    Date.now() - flow.createdAt > 10 * 60 * 1000
  ) {
    throw new Error("The OpenRouter connection expired or did not match this browser.");
  }
  const sessionResponse = await fetch("/api/session", { cache: "no-store" });
  const session = (await sessionResponse.json()) as { username?: string };
  if (!sessionResponse.ok || !flow.username || session.username !== flow.username) {
    throw new Error("The OpenRouter connection belongs to a different greCAPTCHA account.");
  }
  const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: flow.verifier,
      code_challenge_method: "S256",
    }),
  });
  if (!response.ok) throw new Error("OpenRouter could not create the browser-managed key.");
  const payload = (await response.json()) as { key?: string };
  if (!payload.key) throw new Error("OpenRouter did not return an API key.");
  const inspected = await inspectKey(payload.key, session.username);
  if (flow.storage === "server") {
    const stored = await fetch("/api/openrouter/credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openrouterApiKey: inspected.key }),
    });
    const storedPayload = (await stored.json()) as { error?: string };
    if (!stored.ok) {
      throw new Error(storedPayload.error ?? "Unable to save the professor OpenRouter key.");
    }
    window.dispatchEvent(new Event("grecaptcha:openrouter-credential-changed"));
    return { serverStored: true };
  }
  localStorage.setItem(KEY_STORAGE, JSON.stringify(inspected));
  return inspected;
}
