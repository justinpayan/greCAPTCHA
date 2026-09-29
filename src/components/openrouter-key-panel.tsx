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
  error: pageError = "",
}: {
  apiKey: string;
  source: KeySource;
  onChange: (apiKey: string, source: KeySource) => void;
  onReady?: (apiKey: string, source: KeySource) => void;
  /** An OpenRouter problem the page ran into elsewhere, shown under the key controls. */
  error?: string;
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

  // OAuth completion is handled by the dashboard because it owns the callback URL. Reflect the
  // newly stored key as soon as that async exchange updates the controlled selection, without
  // requiring a page refresh.
  useEffect(() => {
    if (source !== "oauth" || !apiKey) return;
    const stored = readBrowserOpenRouterKey();
    if (stored?.key === apiKey) setBrowserKey(stored);
  }, [apiKey, source]);

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
    setChecking(true);
    setError("");
    try {
      await beginOpenRouterOAuth();
      const checked = await validateBrowserOpenRouterKey();
      setBrowserKey(checked);
      onChange(checked.key, "oauth");
      onReady?.(checked.key, "oauth");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start OpenRouter sign-in.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="key-source-panel">
      <div className="key-source-main">
        <strong>API Access</strong>
        <p>
          Connect with OpenRouter or paste an API key for this action. A connected key stays in
          this browser; a pasted key is held only long enough to run the job. Neither is stored by
          greCAPTCHA.
        </p>
        <p className="key-warning">
          Connected keys require a <strong>positive spending limit</strong> and{" "}
          <strong>future expiration date</strong>.
        </p>
      </div>
      <aside className="key-source-oauth">
        {browserKey ? (
          <>
            <strong>OpenRouter connected</strong>
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
              <button
                className="secondary"
                type="button"
                disabled={checking}
                onClick={() => void connect()}
              >
                Replace with OpenRouter
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
          <button
            className="secondary"
            type="button"
            disabled={checking}
            onClick={() => void connect()}
          >
            {checking ? "Waiting for OpenRouter…" : "Connect with OpenRouter"}
          </button>
        )}
        <div className="key-paste-control">
          <label htmlFor="openrouterApiKey">
            {browserKey ? "Or use a pasted key" : "Or paste an API key"}
          </label>
          <input
            className="control"
            id="openrouterApiKey"
            name="grecaptcha-openrouter-api-key"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            value={source === "paste" ? apiKey : ""}
            placeholder="sk-or-v1-…"
            onChange={(event) => onChange(event.target.value, "paste")}
            onBlur={() => {
              if (source === "paste" && apiKey.trim()) onReady?.(apiKey.trim(), "paste");
            }}
          />
        </div>
        {[error, pageError]
          .filter((message, index, all) => message && all.indexOf(message) === index)
          .map((message) => (
            <p className="error" role="alert" key={message}>
              {message}
            </p>
          ))}
      </aside>
    </section>
  );
}
