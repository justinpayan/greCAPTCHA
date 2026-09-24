"use client";

import { useCallback, useEffect, useState } from "react";

import { beginOpenRouterOAuth } from "@/lib/openrouter-browser-key";

type CredentialStatus =
  | { connected: false }
  | {
      connected: true;
      spendingLimit: number;
      limitRemaining: number | null;
      expiresAt: string;
    };

export function ProfessorOpenRouterPanel() {
  const [status, setStatus] = useState<CredentialStatus>({ connected: false });
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const [pastedKey, setPastedKey] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/openrouter/credential", { cache: "no-store" });
    const payload = (await response.json()) as CredentialStatus & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load OpenRouter status.");
    setStatus(payload);
  }, []);

  useEffect(() => {
    void refresh().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load OpenRouter status."),
    );
    const listener = () => void refresh();
    window.addEventListener("grecaptcha:openrouter-credential-changed", listener);
    return () => window.removeEventListener("grecaptcha:openrouter-credential-changed", listener);
  }, [refresh]);

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    try {
      const response = await fetch("/api/openrouter/credential", { method: "DELETE" });
      const payload = (await response.json()) as CredentialStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to disconnect OpenRouter.");
      setStatus(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to disconnect OpenRouter.");
    } finally {
      setBusy(null);
    }
  }

  async function savePastedKey() {
    const openrouterApiKey = pastedKey.trim();
    if (!openrouterApiKey) return;
    setBusy("save");
    setError("");
    setPastedKey("");
    try {
      const response = await fetch("/api/openrouter/credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey }),
      });
      const payload = (await response.json()) as CredentialStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to save the OpenRouter key.");
      setStatus(payload);
      window.dispatchEvent(new Event("grecaptcha:openrouter-credential-changed"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the OpenRouter key.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="key-source-panel">
      <div className="key-source-main">
        <strong>Course grading credential</strong>
        <p>
          Connect with PKCE or paste an app-specific OpenRouter key once. Either credential is
          encrypted on the server and used automatically when a student submits a course
          assessment.
        </p>
        <p className="key-warning">
          OpenRouter requires a positive spending limit and future expiration date.
        </p>
      </div>
      <aside className="key-source-oauth">
        {status.connected ? (
          <>
            <strong>OpenRouter connected</strong>
            <small>
              Limit ${status.spendingLimit}
              {status.limitRemaining !== null
                ? ` · $${status.limitRemaining} remaining`
                : ""}{" "}
              · expires {new Date(status.expiresAt).toLocaleDateString()}
            </small>
            <div className="key-source-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy !== null}
                onClick={() => void beginOpenRouterOAuth("server")}
              >
                Replace with PKCE
              </button>
              <button
                className="secondary danger"
                type="button"
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </>
        ) : (
          <button
            className="secondary"
            type="button"
            disabled={busy !== null}
            onClick={() => void beginOpenRouterOAuth("server")}
          >
            Connect with PKCE
          </button>
        )}
        <div className="key-paste-control">
          <label htmlFor="professorOpenRouterKey">
            {status.connected ? "Or replace with a pasted key" : "Or paste an API key"}
          </label>
          <input
            id="professorOpenRouterKey"
            className="control"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={pastedKey}
            placeholder="sk-or-v1-…"
            disabled={busy !== null}
            onChange={(event) => setPastedKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void savePastedKey();
              }
            }}
          />
          <button
            className="secondary"
            type="button"
            disabled={busy !== null || !pastedKey.trim()}
            onClick={() => void savePastedKey()}
          >
            {busy === "save"
              ? "Saving…"
              : status.connected
                ? "Replace with pasted key"
                : "Save pasted key"}
          </button>
          <small>The key value is never shown again after submission.</small>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </aside>
    </section>
  );
}
