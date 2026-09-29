"use client";

import { OpenRouterError } from "@/lib/openrouter-errors";

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
export const OPENROUTER_OAUTH_CHANNEL = "grecaptcha.openrouter.oauth";

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

export function readOpenRouterOAuthNonce(): string | null {
  try {
    const flow = JSON.parse(sessionStorage.getItem(FLOW_STORAGE) ?? "null") as {
      nonce?: string;
    } | null;
    return flow?.nonce ?? null;
  } catch {
    return null;
  }
}

async function inspectKey(key: string, ownerUsername: string): Promise<BrowserOpenRouterKey> {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!response.ok) throw new OpenRouterError("OpenRouter rejected the browser-managed key.");
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
    throw new OpenRouterError(`Set a positive spending limit before using this key. Open its settings: ${settingsUrl}`);
  }
  if (!expiresAt) {
    throw new OpenRouterError(`Set a future expiration date before using this key. Open its settings: ${settingsUrl}`);
  }
  const expiration = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiration) || expiration <= Date.now()) {
    throw new OpenRouterError(`Set a future expiration date before using this key. Open its settings: ${settingsUrl}`);
  }
  const limitRemaining = payload.data?.limit_remaining ?? null;
  if (limitRemaining !== null && limitRemaining <= 0) {
    throw new OpenRouterError(`This key has exhausted its spending limit. Open its settings: ${settingsUrl}`);
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
  if (!sessionResponse.ok || !session.username) throw new OpenRouterError("Sign in to use this key.");
  const stored = readBrowserOpenRouterKey(session.username);
  if (!stored) throw new OpenRouterError("Connect a browser-managed OpenRouter key first.");
  const inspected = await inspectKey(stored.key, session.username);
  localStorage.setItem(KEY_STORAGE, JSON.stringify(inspected));
  return inspected;
}

export async function beginOpenRouterOAuth(storage: "browser" | "server" = "browser") {
  const popup = window.open(
    "about:blank",
    "grecaptcha-openrouter-oauth",
    "popup=yes,width=560,height=760,resizable=yes,scrollbars=yes",
  );
  if (!popup) {
    throw new OpenRouterError(
      "The OpenRouter authorization popup was blocked. Allow popups for this site and try again.",
    );
  }
  popup.document.title = "Connecting to OpenRouter";
  popup.document.body.textContent = "Preparing OpenRouter authorization…";

  const sessionResponse = await fetch("/api/session", { cache: "no-store" });
  const session = (await sessionResponse.json()) as { username?: string };
  if (!sessionResponse.ok || !session.username) {
    popup.close();
    throw new OpenRouterError("Sign in before connecting an OpenRouter key.");
  }
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(verifierBytes);
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = base64Url(await sha256(verifier));
  const flow = JSON.stringify({
    verifier,
    nonce,
    username: session.username,
    storage,
    createdAt: Date.now(),
  });
  try {
    popup.sessionStorage.setItem(FLOW_STORAGE, flow);
  } catch {
    popup.close();
    throw new OpenRouterError("The authorization popup could not initialize browser storage.");
  }
  const callback = new URL("/openrouter/callback", window.location.origin);
  callback.searchParams.set("openrouter_oauth", nonce);
  const authorize = new URL("https://openrouter.ai/auth");
  authorize.searchParams.set("callback_url", callback.toString());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("key_label", "greCAPTCHA browser key");
  popup.location.replace(authorize.toString());

  await new Promise<void>((resolve, reject) => {
    const channel = new BroadcastChannel(OPENROUTER_OAUTH_CHANNEL);
    let settled = false;
    const cleanup = () => {
      settled = true;
      channel.close();
      window.removeEventListener("message", receiveWindowMessage);
      window.clearInterval(closedTimer);
      window.clearTimeout(expirationTimer);
    };
    const receive = (data: unknown) => {
      const message = data as {
        type?: string;
        nonce?: string;
        ok?: boolean;
        error?: string;
      };
      if (message.type !== "openrouter-oauth-result" || message.nonce !== nonce) return;
      cleanup();
      if (message.ok) {
        window.dispatchEvent(new Event("grecaptcha:openrouter-credential-changed"));
        resolve();
      } else {
        reject(new OpenRouterError(message.error ?? "OpenRouter authorization failed."));
      }
    };
    const receiveWindowMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === popup) receive(event.data);
    };
    channel.onmessage = (event) => receive(event.data);
    window.addEventListener("message", receiveWindowMessage);
    const closedTimer = window.setInterval(() => {
      if (!settled && popup.closed) {
        cleanup();
        reject(new OpenRouterError("The OpenRouter authorization popup was closed."));
      }
    }, 500);
    const expirationTimer = window.setTimeout(() => {
      if (!settled) {
        cleanup();
        popup.close();
        reject(new OpenRouterError("The OpenRouter authorization popup expired."));
      }
    }, 10 * 60 * 1000);
  });
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
  if (!flowRaw || !code) throw new OpenRouterError("The OpenRouter connection could not be verified.");
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
    throw new OpenRouterError("The OpenRouter connection expired or did not match this browser.");
  }
  const sessionResponse = await fetch("/api/session", { cache: "no-store" });
  const session = (await sessionResponse.json()) as { username?: string };
  if (!sessionResponse.ok || !flow.username || session.username !== flow.username) {
    throw new OpenRouterError("The OpenRouter connection belongs to a different greCAPTCHA account.");
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
  if (!response.ok) throw new OpenRouterError("OpenRouter could not create the browser-managed key.");
  const payload = (await response.json()) as { key?: string };
  if (!payload.key) throw new OpenRouterError("OpenRouter did not return an API key.");
  const inspected = await inspectKey(payload.key, session.username);
  if (flow.storage === "server") {
    const stored = await fetch("/api/openrouter/credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openrouterApiKey: inspected.key }),
    });
    const storedPayload = (await stored.json()) as { error?: string };
    if (!stored.ok) {
      throw new OpenRouterError(
        storedPayload.error ?? "Unable to save the test creator's OpenRouter key.",
      );
    }
    window.dispatchEvent(new Event("grecaptcha:openrouter-credential-changed"));
    return { serverStored: true };
  }
  localStorage.setItem(KEY_STORAGE, JSON.stringify(inspected));
  return inspected;
}
