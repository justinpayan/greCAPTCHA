"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { Brand } from "@/components/brand";

export function LoginForm({ next, signup = false }: { next: string; signup?: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = await fetch(signup ? "/api/signup" : "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, passwordConfirmation, openrouterApiKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to sign in.");
      // A full navigation, so the new cookie is present for the next request.
      window.location.href = next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
      setWorking(false);
    }
  }

  return (
    <main className="app-shell">
      <Brand />
      <section>
        <p className="eyebrow">Public demo</p>
        <h1>{signup ? "Create your account." : "Welcome back."}</h1>
        <p className="lede">
          {signup
            ? "Create an account to take shared assessments. Add an OpenRouter key only if you also want to generate your own question sets."
            : "Sign in to return to your saved sets and attempts."}
        </p>
      </section>
      <form className="card form-card login-card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            className="control"
            id="username"
            value={username}
            autoFocus
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            className="control"
            id="password"
            type="password"
            value={password}
            autoComplete={signup ? "new-password" : "current-password"}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {signup && (
          <>
            <div className="field">
              <label htmlFor="passwordConfirmation">Confirm password</label>
              <input
                className="control"
                id="passwordConfirmation"
                type="password"
                value={passwordConfirmation}
                autoComplete="new-password"
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="openrouterApiKey">OpenRouter API key (optional)</label>
              <input
                className="control"
                id="openrouterApiKey"
                type="password"
                value={openrouterApiKey}
                autoComplete="off"
                onChange={(event) => setOpenrouterApiKey(event.target.value)}
              />
              <span className="hint">
                Required only for generating question sets. If provided, it is validated and
                encrypted at rest.
              </span>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="submit-row">
          <span className="hint">
            {signup ? (
              <>Already registered? <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>.</>
            ) : (
              <>Need an account? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create one</Link>.</>
            )}
          </span>
          <button className="primary" type="submit" disabled={working || !username || !password}>
            {working ? "Working…" : signup ? "Create account" : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
