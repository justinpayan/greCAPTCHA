"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { Brand } from "@/components/brand";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, passwordConfirmation }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to change password.");
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      setChanged(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change password.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="app-shell auth-shell">
      <Brand href="/" />
      <section>
        <p className="eyebrow">Account security</p>
        <h1>Change your password.</h1>
        <p className="lede">
          Confirm your current password, then choose a new one with at least 10 characters.
        </p>
      </section>
      <form className="card form-card login-card" onSubmit={submit}>
        {changed ? (
          <>
            <p className="template-status" role="status">
              Your password was changed. Other signed-in sessions have been revoked.
            </p>
            <Link className="primary button-link" href="/">
              Return to dashboard
            </Link>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="currentPassword">Current password</label>
              <input
                className="control"
                id="currentPassword"
                type="password"
                value={currentPassword}
                autoFocus
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="newPassword">New password</label>
              <input
                className="control"
                id="newPassword"
                type="password"
                value={newPassword}
                minLength={10}
                maxLength={200}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="passwordConfirmation">Confirm new password</label>
              <input
                className="control"
                id="passwordConfirmation"
                type="password"
                value={passwordConfirmation}
                minLength={10}
                maxLength={200}
                autoComplete="new-password"
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                required
              />
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="submit-row">
              <Link className="secondary button-link" href="/">
                Cancel
              </Link>
              <button
                className="primary"
                type="submit"
                disabled={
                  working ||
                  !currentPassword ||
                  !newPassword ||
                  !passwordConfirmation
                }
              >
                {working ? "Changing…" : "Change password"}
              </button>
            </div>
          </>
        )}
      </form>
    </main>
  );
}
