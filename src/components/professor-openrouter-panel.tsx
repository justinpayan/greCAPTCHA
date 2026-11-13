"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { beginOpenRouterOAuth } from "@/lib/openrouter-browser-key";
import type { EndpointInfo } from "@/lib/use-model-endpoints";
import { userFacingMessage } from "@/lib/user-facing-error";

type CredentialStatus =
  | { connected: false }
  | {
      connected: true;
      /** Null for an institution key whose gateway reports no budget or expiry. */
      spendingLimit: number | null;
      limitRemaining: number | null;
      expiresAt: string | null;
    };

/**
 * The switch between OpenRouter and the user's institution endpoint, shown only to users the
 * operator assigned to one. It picks where this test's model requests go; each test keeps the
 * endpoint it was created with.
 */
export function EndpointSwitch({
  endpoint,
  endpoints,
  onChange,
}: {
  endpoint: string;
  endpoints: EndpointInfo[] | null;
  onChange: (endpoint: string) => void;
}) {
  if (!endpoints || endpoints.length < 2) return null;
  return (
    <div className="manuscript-source" role="radiogroup" aria-label="Model endpoint">
      {endpoints.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="radio"
          aria-checked={endpoint === entry.id}
          className={endpoint === entry.id ? "active" : ""}
          onClick={() => onChange(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

function keySummary(status: Extract<CredentialStatus, { connected: true }>) {
  const parts: string[] = [];
  if (status.spendingLimit !== null) {
    parts.push(
      `Limit $${status.spendingLimit}${
        status.limitRemaining !== null ? ` · $${status.limitRemaining} remaining` : ""
      }`,
    );
  }
  if (status.expiresAt) parts.push(`expires ${new Date(status.expiresAt).toLocaleDateString()}`);
  return parts.join(" · ") || "No budget or expiry reported";
}

/**
 * The test creator's stored key for the chosen endpoint, with the switch between endpoints for
 * users assigned to an institution. A creator may store one key per endpoint.
 *
 * `error` is a key problem the page ran into elsewhere (generating, grading, finishing the
 * OpenRouter sign-in); it is shown here, under the key controls, alongside the panel's own errors.
 */
export function ProfessorOpenRouterPanel({
  error: pageError = "",
  endpoint = "openrouter",
  endpoints = null,
  onEndpointChange,
}: {
  error?: string;
  endpoint?: string;
  endpoints?: EndpointInfo[] | null;
  onEndpointChange?: (endpoint: string) => void;
}) {
  const [status, setStatus] = useState<CredentialStatus>({ connected: false });
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const [pastedKey, setPastedKey] = useState("");
  const [error, setError] = useState("");
  // An institution gateway has no sign-in flow: its keys are pasted.
  const institution = endpoint !== "openrouter";
  const label = endpoints?.find((entry) => entry.id === endpoint)?.label ?? "OpenRouter";
  // A status that arrives after a switch belongs to the other endpoint and is dropped.
  const shownEndpoint = useRef(endpoint);
  shownEndpoint.current = endpoint;

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/openrouter/credential?endpoint=${encodeURIComponent(endpoint)}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as CredentialStatus & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load the API key status.");
    if (shownEndpoint.current === endpoint) setStatus(payload);
  }, [endpoint]);

  useEffect(() => {
    setStatus({ connected: false });
    setError("");
    void refresh().catch((caught) =>
      setError(userFacingMessage(caught, "Unable to load the API key status.")),
    );
    const listener = () => void refresh();
    window.addEventListener("grecaptcha:openrouter-credential-changed", listener);
    return () => window.removeEventListener("grecaptcha:openrouter-credential-changed", listener);
  }, [refresh]);

  async function connect() {
    setBusy("save");
    setError("");
    try {
      await beginOpenRouterOAuth("server");
      await refresh();
    } catch (caught) {
      setError(userFacingMessage(caught, "Unable to start OpenRouter sign-in."));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    try {
      const response = await fetch(`/api/openrouter/credential?endpoint=${encodeURIComponent(endpoint)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as CredentialStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Unable to disconnect ${label}.`);
      setStatus(payload);
      window.dispatchEvent(new Event("grecaptcha:openrouter-credential-changed"));
    } catch (caught) {
      setError(userFacingMessage(caught, `Unable to disconnect ${label}.`));
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
        body: JSON.stringify({ openrouterApiKey, endpoint }),
      });
      const payload = (await response.json()) as CredentialStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Unable to save the ${label} key.`);
      setStatus(payload);
      window.dispatchEvent(new Event("grecaptcha:openrouter-credential-changed"));
    } catch (caught) {
      setError(userFacingMessage(caught, `Unable to save the ${label} key.`));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="key-source-panel">
      <div className="key-source-main">
        <div className="key-source-heading">
          <strong>API Access</strong>
          {onEndpointChange && (
            <EndpointSwitch endpoint={endpoint} endpoints={endpoints} onChange={onEndpointChange} />
          )}
        </div>
        {institution ? (
          <p>
            Paste your {label} API key once. It is encrypted on the server and used automatically
            whenever this test is generated or graded. Test takers never need a key for it.
          </p>
        ) : (
          <>
            <p>
              Connect with OpenRouter or paste an app-specific OpenRouter key once. Either
              credential is encrypted on the server and used automatically whenever the test
              creator pays for generation or grading.
            </p>
            <p className="key-warning">
              OpenRouter requires a <strong>positive spending limit</strong> and{" "}
              <strong>future expiration date</strong>.
            </p>
          </>
        )}
      </div>
      <aside className="key-source-oauth">
        {status.connected ? (
          <>
            <strong>{label} connected</strong>
            <small>{keySummary(status)}</small>
            <div className="key-source-actions">
              {!institution && (
                <button
                  className="secondary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void connect()}
                >
                  Replace with OpenRouter
                </button>
              )}
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
          !institution && (
            <button
              className="secondary"
              type="button"
              disabled={busy !== null}
              onClick={() => void connect()}
            >
              Connect with OpenRouter
            </button>
          )
        )}
        <div className="key-paste-control">
          <label htmlFor="creatorOpenRouterKey">
            {institution
              ? status.connected
                ? "Replace with another key"
                : `${label} API key`
              : status.connected
                ? "Or replace with a pasted key"
                : "Or paste an API key"}
          </label>
          <input
            id="creatorOpenRouterKey"
            className="control"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={pastedKey}
            placeholder={institution ? "sk-…" : "sk-or-v1-…"}
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
