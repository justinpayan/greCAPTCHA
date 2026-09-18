"use client";

import { useEffect, useState } from "react";

import {
  beginOpenRouterOAuth,
  disconnectBrowserOpenRouterKey,
  readBrowserOpenRouterKey,
  validateBrowserOpenRouterKey,
  type BrowserOpenRouterKey,
  type KeySource,
} from "@/lib/openrouter-browser-key";

export function OpenRouterKeyPanel({
  apiKey,
  source,
  onChange,
  onReady,
}: {
  apiKey: string;
  source: KeySource;
  onChange: (apiKey: string, source: KeySource) => void;
  onReady?: (apiKey: string, source: KeySource) => void;
}) {
  const [browserKey, setBrowserKey] = useState<BrowserOpenRouterKey | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session: { username?: string }) => {
        const stored = session.username ? readBrowserOpenRouterKey(session.username) : null;
        setBrowserKey(stored);
        if (stored && source === "oauth") onChange(stored.key, "oauth");
      });
  }, []); // The parent callback is intentionally not a subscription.

  async function useBrowserKey() {
    setChecking(true);
    setError("");
    try {
      const checked = await validateBrowserOpenRouterKey();
      setBrowserKey(checked);
      onChange(checked.key, "oauth");
      onReady?.(checked.key, "oauth");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to verify the key.");
    } finally {
      setChecking(false);
    }
  }

  async function connect() {
    setError("");
    try {
      await beginOpenRouterOAuth();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start OpenRouter sign-in.");
    }
  }

  return (
    <section className="key-source-panel">
      <div className="key-source-main">
        <label htmlFor="openrouterApiKey">OpenRouter API key</label>
        <input
          className="control"
          id="openrouterApiKey"
          name="grecaptcha-openrouter-api-key"
          type="password"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          value={source === "paste" ? apiKey : ""}
          disabled={source === "oauth"}
          placeholder={source === "oauth" ? "Using browser-managed key" : "Paste for this action"}
          onChange={(event) => onChange(event.target.value, "paste")}
          onBlur={() => {
            if (source === "paste" && apiKey.trim()) onReady?.(apiKey.trim(), "paste");
          }}
        />
        <small>
          Pasted keys are sent over HTTPS for this job, held only in server memory, and never
          saved by greCAPTCHA.
        </small>
      </div>
      <aside className="key-source-oauth">
        <strong>Browser-managed key</strong>
        <p>
          OpenRouter creates the key and your browser stores it. Creation and storage never send
          the key to greCAPTCHA. When you run a job, it is sent ephemerally to our server and is
          never persisted.
        </p>
        <p className="key-warning">
          Required: set a low spending limit and a short expiration date. Keys without both are
          rejected.
        </p>
        {browserKey ? (
          <>
            <small>
              Limit ${browserKey.limit}
              {browserKey.limitRemaining !== null
                ? ` · $${browserKey.limitRemaining} remaining`
                : ""}{" "}
              · expires {new Date(browserKey.expiresAt).toLocaleDateString()}
            </small>
            <div className="key-source-actions">
              <button className="secondary" type="button" disabled={checking} onClick={useBrowserKey}>
                {checking ? "Checking…" : source === "oauth" ? "Recheck safeguards" : "Use this key"}
              </button>
              <a className="secondary button-link" href={browserKey.settingsUrl} target="_blank" rel="noreferrer">
                Open key settings
              </a>
              <button
                className="secondary danger"
                type="button"
                onClick={() => {
                  disconnectBrowserOpenRouterKey();
                  setBrowserKey(null);
                  onChange("", "paste");
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <button className="secondary" type="button" onClick={() => void connect()}>
            Connect with OpenRouter
          </button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </aside>
    </section>
  );
}
