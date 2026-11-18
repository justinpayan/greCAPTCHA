"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { userFacingMessage } from "@/lib/user-facing-error";

export function LoginForm({ next, signup = false }: { next: string; signup?: boolean }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    // Read from the form itself: a password manager can fill the fields without the change events
    // that update state, and pressing Enter must still sign in with what is shown.
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    setWorking(true);
    setError("");
    try {
      const response = await fetch(signup ? "/api/signup" : "/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: field("username"),
          email: field("email"),
          password: field("password"),
          passwordConfirmation: field("passwordConfirmation"),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to sign in.");
      // A full navigation, so the new cookie is present for the next request.
      window.location.href = payload.next
        ? `${payload.next}${payload.next.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`
        : next;
    } catch (caught) {
      setError(userFacingMessage(caught, "Unable to sign in."));
      setWorking(false);
    }
  }

  return (
    <main className="app-shell auth-shell">
      <Brand href="/" />
      <section>
        <h1>{signup ? "Create your account." : "Welcome back."}</h1>
        <p className="lede">
          {signup
            ? "Create an account to take shared assessments or generate your own question sets."
            : "Sign in to return to your saved sets and attempts."}
        </p>
      </section>
      <form className="card form-card login-card" onSubmit={submit}>
        {signup && <div className="field">
          <label htmlFor="email">Email</label>
          <input className="control" id="email" name="email" type="email" autoComplete="email" required
            value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>}
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            className="control"
            id="username"
            name="username"
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
            name="password"
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
                name="passwordConfirmation"
                type="password"
                value={passwordConfirmation}
                autoComplete="new-password"
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                required
              />
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="submit-row">
          <div className="account-auth-alternative">
            {signup ? (
              <><Link className="secondary button-link" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>
            ) : (
              <><Link className="secondary button-link" href={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link></>
            )}
          </div>
          {/* Enabled whenever not already working: a disabled submit button stops Enter from
              submitting the form, and the required fields already block an empty submit. */}
          <button className="primary" type="submit" disabled={working}>
            {working ? "Working…" : signup ? "Create account" : "Sign in"}
          </button>
        </div>
      </form>
      {!signup && <Link className="secondary button-link" href="/account/forgot-password">Forgot password?</Link>}
    </main>
  );
}
