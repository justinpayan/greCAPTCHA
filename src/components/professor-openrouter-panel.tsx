"use client";

import { useCallback, useEffect, useState } from "react";

import { beginOpenRouterOAuth } from "@/lib/openrouter-browser-key";

type CredentialStatus =
  | { connected: false }
  | {
      connected: true;
      label: string | null;
      spendingLimit: number;
      limitRemaining: number | null;
      expiresAt: string;
    };

export function ProfessorOpenRouterPanel() {
  const [status, setStatus] = useState<CredentialStatus>({ connected: false });
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/openrouter/credential", { method: "DELETE" });
      const payload = (await response.json()) as CredentialStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to disconnect OpenRouter.");
      setStatus(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to disconnect OpenRouter.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="key-source-panel">
      <div className="key-source-main">
        <strong>Course grading credential</strong>
        <p>
          Connect an app-specific OpenRouter key once. It is encrypted on the server and used
          automatically when a student submits a course assessment.
        </p>
        <p className="key-warning">
          OpenRouter requires a positive spending limit and future expiration date.
        </p>
      </div>
      <aside className="key-source-oauth">
        {status.connected ? (
          <>
            <strong>{status.label ?? "OpenRouter connected"}</strong>
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
                onClick={() => void beginOpenRouterOAuth("server")}
              >
                Replace key
              </button>
              <button
                className="secondary danger"
                type="button"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </>
        ) : (
          <button
            className="secondary"
            type="button"
            onClick={() => void beginOpenRouterOAuth("server")}
          >
            Connect professor OpenRouter account
          </button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </aside>
    </section>
  );
}
