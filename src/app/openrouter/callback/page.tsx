"use client";

import { useEffect, useRef, useState } from "react";

import {
  completeOpenRouterOAuth,
  OPENROUTER_OAUTH_CHANNEL,
  readOpenRouterOAuthNonce,
} from "@/lib/openrouter-browser-key";
import { userFacingMessage } from "@/lib/user-facing-error";

export default function OpenRouterCallbackPage() {
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // React Strict Mode runs effects twice in development. The first pass consumes the one-time
    // authorization code and removes it from the URL, so a second pass would report a false error.
    if (started.current) return;
    started.current = true;
    const nonce =
      new URL(window.location.href).searchParams.get("openrouter_oauth") ??
      readOpenRouterOAuthNonce();
    const notify = (message: {
      type: "openrouter-oauth-result";
      nonce: string | null;
      ok: boolean;
      error?: string;
    }) => {
      const channel = new BroadcastChannel(OPENROUTER_OAUTH_CHANNEL);
      channel.postMessage(message);
      channel.close();
      window.opener?.postMessage(message, window.location.origin);
    };

    void completeOpenRouterOAuth()
      .then((result) => {
        if (!result) throw new Error("OpenRouter did not return an authorization result.");
        notify({ type: "openrouter-oauth-result", nonce, ok: true });
        window.setTimeout(() => window.close(), 250);
      })
      .catch((caught) => {
        const message =
          userFacingMessage(caught, "Unable to complete OpenRouter authorization.");
        setError(message);
        notify({ type: "openrouter-oauth-result", nonce, ok: false, error: message });
      });
  }, []);

  return (
    <main className="app-shell">
      <section className="card form-card">
        <p className="eyebrow">OpenRouter authorization</p>
        <h1>{error ? "Connection failed" : "Finishing connection…"}</h1>
        {error ? (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <button className="secondary" type="button" onClick={() => window.close()}>
              Close this window
            </button>
          </>
        ) : (
          <p className="hint">This window will close automatically.</p>
        )}
      </section>
    </main>
  );
}
