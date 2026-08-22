"use client";

import { FormEvent, useState } from "react";

import { Brand } from "@/components/brand";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
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
        <p className="eyebrow">Researcher access</p>
        <h1>Sign in.</h1>
        <p className="lede">
          The assessment link given to a participant does not need this password. It is only
          for building sets, reviewing plans, and browsing results.
        </p>
      </section>
      <form className="card form-card login-card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="password">Researcher password</label>
          <input
            className="control"
            id="password"
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="submit-row">
          <span className="hint">Sessions last 12 hours.</span>
          <button className="primary" type="submit" disabled={working || !password}>
            {working ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
