"use client";

import { FormEvent, useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import Link from "next/link";
import { Brand } from "@/components/brand";

type Device = { id: string; label: string; createdAt: string; expiresAt: string; lastUsedAt: string };
type Status = { passkeys: { id: string; name: string }[]; authenticator: boolean; username: string; email: string | null; mfaEnabled: boolean; mfaVerified: boolean; hasRemainingTests: boolean; devices: Device[] };
type Enrollment = { enrollmentToken: string; setupKey: string; qrCode: string };
type Codes = { codes: string[]; acknowledgementToken: string };
const headings: Record<string, string> = {
  settings: "Settings", email: "Change email", mfa: "Passkeys and MFA", delete: "Delete account",
  "verify-email": "Verify email", "forgot-password": "Forgot password", "reset-password": "Reset password",
  challenge: "Verify your sign-in", onboarding: "Protect your account",
};
const publicSections = ["verify-email", "forgot-password", "reset-password", "challenge"];

function destination() {
  const next = new URLSearchParams(window.location.search).get("next") || "/";
  const url = new URL(next, window.location.origin);
  return url.origin === window.location.origin ? url.pathname + url.search : "/";
}

export function AccountSettings({ section, initialVerification = false, pendingEmail = "" }: { section: string; initialVerification?: boolean; pendingEmail?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState(pendingEmail);
  const [verificationSent, setVerificationSent] = useState(Boolean(pendingEmail));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<Codes | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  const [setupMethod, setSetupMethod] = useState<"passkey" | "authenticator">("passkey");
  const [grant, setGrant] = useState("");
  const [keyName, setKeyName] = useState("");
  const [useKey, setUseKey] = useState(false);
  const [methods, setMethods] = useState({ passkey: false, authenticator: false });
  const canUseKey = Boolean(status?.passkeys.length || methods.passkey);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/account/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (result.unlockRequired) setGrant("");
    if (!response.ok) throw new Error(result.error || "Unable to complete this action.");
    return result;
  }
  async function loadStatus() {
    const response = await fetch("/api/account/security", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load Settings.");
    setStatus(payload);
  }

  useEffect(() => {
    if (section === "mfa" && window.location.hash === "#authenticator") setSetupMethod("authenticator");
    // Keep bearer tokens out of subsequent URLs and browser history entries.
    // Strict Mode repeats this effect in development: an already-cleared hash must
    // not overwrite the token captured by the first pass.
    if (["verify-email", "reset-password"].includes(section) && window.location.hash) setToken(window.location.hash.slice(1));
    if (["verify-email", "reset-password"].includes(section) && window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (new URLSearchParams(window.location.search).has("retry")) setMessage("Your account was created. Email delivery failed. Enter your details below to try sending verification again.");
    if (!publicSections.includes(section)) void loadStatus().catch((caught) => setError(caught.message));
  }, [section]);

  useEffect(() => {
    if (section !== "challenge" && !(section === "reset-password" && token)) return;
    void post({ action: section, methodsOnly: true, token }).then((result) => {
      setMethods(result);
      setUseKey(result.passkey && !result.authenticator);
    }).catch((err) => setError(err.message));
  }, [section, token]);

  async function perform(action: string, extra: Record<string, unknown> = {}) {
    if (working) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const body: Record<string, unknown> = { action, email, password, confirmation, code, token, remember, acknowledged, grant, ...extra };
      if ((action === "start-key" || useKey) && !window.PublicKeyCredential) throw new Error("This browser cannot use passkeys. Choose an authenticator app or a backup code.");
      if (useKey && canUseKey && (section !== "mfa" || action === "unlock-settings") && !["finish-enrollment", "acknowledge-codes"].includes(action)) {
        const { options, ticket } = await post({ ...body, preparePasskey: true });
        const assertion = await startAuthentication({ optionsJSON: options });
        Object.assign(body, { assertion, ticket });
      }
      let payload = await post(body);
      if (action === "start-key") {
        const registration = await startRegistration({ optionsJSON: payload.options });
        payload = await post({ action: "finish-key", ticket: payload.ticket, registration });
      }
      if (payload.signIn || action.startsWith("remove-") || (action === "finish-enrollment" && !payload.codes.length)) {
        window.location.href = "/login";
        return;
      }
      if (action === "unlock-settings") {
        setGrant(payload.grant);
        setPassword("");
        setCode("");
        setUseKey(false);
      } else if (action === "begin-enrollment") {
        setEnrollment(payload); setCode(""); setPassword("");
      } else if (action === "start-key" || action === "finish-enrollment" || action === "regenerate-codes") {
        setCodes(payload); setEnrollment(null); setPassword(""); setCode("");
      } else if (action === "acknowledge-codes" || action === "challenge") {
        window.location.href = destination();
      } else if (action === "send-verification") {
        setVerificationSent(true); setMessage("Verification email sent."); setPassword(""); setCode("");
      } else if (action === "forgot-password") {
        setMessage("If this email address is verified for an account, a password reset link will be sent to it.");
      } else if (action === "verify-email" || action === "reset-password") {
        setComplete(true); setPassword(""); setCode("");
        setMessage(action === "verify-email" ? "Your email is verified. Sign in to continue." : "Your password was reset. Sign in with your new password.");
      } else if (action === "delete-account") {
        setComplete(true); setMessage("Your account has been deleted. Your submissions to other users' tests are retained by their test administrators. Contact each test administrator to request submission deletion.");
      } else if (action === "revoke-device") {
        setMessage("Browser trust revoked. Sign in again if this was your current browser."); setCode("");
        await loadStatus();
      }
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "NotAllowedError" ? "Passkey verification was canceled or unavailable. Try again or choose another method." : caught instanceof Error ? caught.message : "Unable to complete this action.");
    } finally { setWorking(false); }
  }

  function submit(event: FormEvent, action: string, extra?: Record<string, unknown>) {
    event.preventDefault();
    void perform(action, extra);
  }

  const methodChoice = canUseKey && <div className="field"><label htmlFor="factor-choice">Verification method</label>
    <select className="control" id="factor-choice" value={useKey ? "passkey" : "code"} onChange={(event) => setUseKey(event.target.value === "passkey")}>
      <option value="passkey">Passkey</option><option value="code">{(status?.authenticator || methods.authenticator) ? "Authenticator or backup code" : "Backup code"}</option>
    </select></div>;
  const credentials = <>
    <div className="field">
      <label htmlFor="settings-password">Current password</label>
      <input id="settings-password" className="control" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200} />
    </div>
    {methodChoice}
    {status?.mfaEnabled && !useKey && <div className="field">
      <label htmlFor="settings-factor">{(status?.authenticator || methods.authenticator) ? "Authenticator or backup code" : "Backup code"}</label>
      <input id="settings-factor" className="control" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
    </div>}
  </>;

  const button = (label: string) => <button className="primary" disabled={working}>{working ? "Working…" : label}</button>;

  return <main className="app-shell dashboard-shell account-shell">
    <header className="account-header">
    <Brand href="/" />
    {!publicSections.includes(section) && <nav className="account-navigation" aria-label="Account navigation">
      {section !== "settings" && <Link className="secondary button-link" href="/account/settings">Settings</Link>}
      <Link className="secondary button-link" href="/">Dashboard</Link>
      <button type="button" className="secondary" onClick={async () => { await fetch("/api/session", { method: "DELETE" }); window.location.href = "/login"; }}>Sign out</button>
    </nav>}
    </header>
    <section className="account-heading">
      <h1>{initialVerification || section === "verify-email" ? "Verify your email address" : headings[section]}</h1>
      {initialVerification && <p>{verificationSent ? "Check your email for a verification link. You can resend it below." : "Enter your email address below to receive a verification link."}</p>}
    </section>
    <div className="account-content">
    {message && <p className="account-notice" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {complete ? <Link className="secondary button-link" href="/login">Sign in</Link> : <>
      {section === "settings" && status && <section className="card form-card account-card account-options">
        <p>Signed in as <strong>{status.username}</strong>.</p>
        {!status.email && <p>Verify your email before continuing to your account.</p>}
        <div className="account-option"><div><h3>Password</h3><p>Update the password you use to sign in.</p></div><Link className="secondary button-link" href="/account/password">Change password</Link></div>
        <div className="account-option"><div><h3>Email address</h3><p>{status.email || "Add a verified address for account recovery."}</p></div><Link className="secondary button-link" href="/account/email">Change email</Link></div>
        <div className="account-option"><div><h3>Passkeys and MFA</h3><p>{status.mfaEnabled ? "Manage your passkeys, authenticator app, backup codes, and trusted browsers." : "Choose a passkey or authenticator app to access test administration."}</p></div><Link className="secondary button-link" href="/account/mfa">Manage passkeys and MFA</Link></div>
        <div className="account-option"><div><h3>Delete account</h3><p>Review what is retained before permanently closing your account.</p></div><Link className="secondary button-link" href="/account/delete">Delete account</Link></div>
      </section>}
      {section === "email" && status && <form className="card form-card account-card" onSubmit={(e) => submit(e, "send-verification")}>
        {status.email && <p>Verified email: {status.email}. Your current address stays active until you verify the replacement.</p>}
        <div className="field"><label htmlFor="recovery-email">{initialVerification ? "Email address" : "New email address"}</label>
          <input id="recovery-email" className="control" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        </div>
        {credentials}{button(initialVerification && verificationSent ? "Resend verification email" : "Send verification email")}
      </form>}
      {section === "verify-email" && <form className="card form-card account-card" onSubmit={(e) => submit(e, "verify-email")}>
        {token ? button("Verify email") : <><p>This page needs the full link from your email. Reopen that link, or request a new verification email.</p><Link className="secondary button-link" href="/account/email">Resend verification email</Link></>}
      </form>}
      {section === "forgot-password" && <form className="card form-card account-card" onSubmit={(e) => submit(e, "forgot-password")}>
        <p>Enter the verified email address associated with your account.</p>
        <div className="field">
          <label htmlFor="recovery-email">Email address</label>
          <input id="recovery-email" className="control" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {button("Send password reset link")}
        <Link className="secondary button-link" href="/login">Return to sign in</Link>
      </form>}
      {section === "reset-password" && <form className="card form-card account-card" onSubmit={(e) => submit(e, "reset-password")}>
        <label htmlFor="reset-password">New password</label>
        <input id="reset-password" className="control" type="password" autoComplete="new-password" minLength={10} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label htmlFor="reset-confirmation">Confirm new password</label>
        <input id="reset-confirmation" className="control" type="password" autoComplete="new-password" minLength={10} maxLength={200} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
        {methodChoice}
        {!useKey && <><label htmlFor="reset-factor">Authenticator or backup code, if enrolled</label>
        <input id="reset-factor" className="control" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></>}
        {token ? button("Reset password") : <Link className="secondary button-link" href="/account/forgot-password">Request a new reset link</Link>}
      </form>}
      {section === "challenge" && <form className="card form-card account-card" onSubmit={(e) => submit(e, "challenge")}>
        {methodChoice}
        {!useKey && <><label htmlFor="login-factor">{(status?.authenticator || methods.authenticator) ? "Authenticator or backup code" : "Backup code"}</label>
        <input id="login-factor" className="control" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></>}
        <label className="account-checkbox"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this device for 30 days</label>
        <p>Remembering this browser requires a passkey or an authenticator code. Save backup codes somewhere you can access if you lose your authenticator.</p>
        {button("Verify sign-in")}<Link className="secondary button-link" href="/login">Return to sign in</Link>
      </form>}
      {section === "onboarding" && <section className="card form-card account-card">
        <p>Set up a passkey or authenticator app to create tests and access test administration, including private PDFs, answers, and grades.</p>
        <Link className="primary button-link" href="/account/mfa#passkey">Set up a passkey</Link>
        <Link className="secondary button-link" href="/account/mfa#authenticator">Set up an authenticator app</Link>
        <Link className="secondary button-link" href="/">Skip for now</Link>
      </section>}
      {section === "mfa" && status && <>
        {!grant && !codes && !enrollment ? <form className="card form-card account-card" onSubmit={e => submit(e, "unlock-settings")}>
          <h2>Verify your identity</h2>
          <p>{status.mfaEnabled ? "Confirm your password and use an enrolled method or backup code to manage your security settings." : "Confirm your password to set up your first security method."}</p>
          {credentials}
          {button("Verify and continue")}
        </form> : codes ? <section className="card form-card account-card">
          <h2>Save your backup codes</h2>
          <p>Each code works once. Store these somewhere safe before continuing. They are displayed only here.</p>
          <pre className="backup-codes">{codes.codes.join("\n")}</pre>
          <label className="account-checkbox"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I saved my backup codes</label>
          <button className="primary" disabled={working || !acknowledged} onClick={() => void perform("acknowledge-codes", { token: codes.acknowledgementToken })}>Continue</button>
        </section> : enrollment ? <form className="card form-card account-card" onSubmit={(e) => submit(e, "finish-enrollment", { token: enrollment.enrollmentToken })}>
          <h2>Connect your authenticator</h2><ol className="account-steps"><li>Open your authenticator app and add an account.</li><li>Scan the QR code below, or enter the setup key manually.</li><li>Enter the six-digit code to confirm.</li></ol>
          {/* Generated locally from the enrollment secret. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="account-qr" src={enrollment.qrCode} alt="Authenticator enrollment QR code" width={240} height={240} />
          <p className="setup-key">{enrollment.setupKey}</p>
          <label htmlFor="enrollment-code">Code from your authenticator</label>
          <input id="enrollment-code" className="control" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} required />
          {button("Confirm authenticator")}
        </form> : <>
          <form className="card form-card account-card" onSubmit={(e) => setupMethod === "passkey" ? submit(e, "start-key", { name: keyName }) : submit(e, "begin-enrollment")}>
            <div className="account-navigation" aria-label="Security method">
              <button type="button" className={setupMethod === "passkey" ? "primary" : "secondary"} aria-pressed={setupMethod === "passkey"} onClick={() => setSetupMethod("passkey")}>Passkeys</button>
              <button type="button" className={setupMethod === "authenticator" ? "primary" : "secondary"} aria-pressed={setupMethod === "authenticator"} onClick={() => setSetupMethod("authenticator")}>Authenticator app</button>
            </div>
            {setupMethod === "passkey" ? <>
              <div className="field"><label htmlFor="passkey-name">New passkey name</label><input className="control" id="passkey-name" placeholder="e.g. My phone" value={keyName} maxLength={80} required onChange={e => setKeyName(e.target.value)} /></div>
              {button("Add passkey")}
              {status.passkeys.map(key => <button className="secondary" type="button" disabled={working} key={key.id} onClick={() => void perform("remove-key", { keyId: key.id })}>Remove passkey · {key.name}</button>)}
            </> : <>
              {button(status.authenticator ? "Replace authenticator" : "Set up authenticator")}
              {status.authenticator && <button className="secondary" type="button" disabled={working} onClick={() => void perform("remove-authenticator")}>Remove authenticator</button>}
            </>}
            {status.mfaEnabled && <button className="secondary" type="button" disabled={working} onClick={() => void perform("regenerate-codes")}>Generate new backup codes</button>}
          </form>
          {status.devices.length > 0 && <section className="card form-card account-card">
            <h2>Trusted browsers</h2>
            {status.devices.map((device) => <div className="account-device" key={device.id}>
              <p className="device-label">{device.label}</p>
              <p>Added {new Date(device.createdAt).toLocaleDateString()} · Last used {new Date(device.lastUsedAt).toLocaleDateString()} · Expires {new Date(device.expiresAt).toLocaleDateString()}</p>
              <button className="secondary" disabled={working} onClick={() => void perform("revoke-device", { deviceId: device.id })}>Revoke browser</button>
            </div>)}
            <button className="secondary" disabled={working} onClick={() => void perform("revoke-device")}>Revoke all browsers</button>
          </section>}
        </>}
      </>}
      {section === "delete" && status && <form className="card form-card account-card" onSubmit={(e) => submit(e, "delete-account")}>
        <p>Delete all of your tests from the dashboard before deleting your account.</p>
        {status.hasRemainingTests && <div className="account-warning" role="alert"><p>You have remaining tests. Delete them before continuing.</p><Link className="secondary button-link" href="/">Manage tests on dashboard</Link></div>}
        <p>Deleting your account removes your sign-in credentials and account access. Your submissions, uploaded materials, answers, grades, and feedback on other users’ tests remain with their test administrators, including the username recorded when you submitted them.</p>
        <p>To request deletion of a submission, contact the test administrator.</p>
        {credentials}
        <label htmlFor="delete-confirmation">Type DELETE to confirm</label>
        <input id="delete-confirmation" className="control" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required pattern="DELETE" autoComplete="off" />
        <button className="primary" disabled={working || status.hasRemainingTests}>{working ? "Working…" : "Delete account permanently"}</button>
      </form>}
    </>}
    </div>
  </main>;
}
