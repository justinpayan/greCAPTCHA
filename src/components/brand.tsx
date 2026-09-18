"use client";

/**
 * The wordmark at the top of a researcher screen.
 *
 * Clickable wherever there is a dashboard to return to, which is every researcher screen except the
 * dashboard itself and the sign-in page. It routes through the same handler as the page's own
 * *Back to dashboard* button rather than navigating to `/`, so the browser-history layer stack it
 * maintains stays in step — a plain link would push an entry and leave Back walking a stale stack.
 */
export function Brand({ onHome }: { onHome?: () => void }) {
  if (!onHome) {
    return (
      <div className="brand">
        <span className="brand-mark">G</span>
        greCAPTCHA
      </div>
    );
  }

  return (
    <button
      className="brand brand-link"
      type="button"
      aria-label="greCAPTCHA — back to the dashboard"
      title="Back to the dashboard"
      onClick={onHome}
    >
      <span className="brand-mark" aria-hidden="true">
        G
      </span>
      greCAPTCHA
    </button>
  );
}
