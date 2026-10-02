"use client";

import Link from "next/link";

/**
 * The wordmark at the top of a researcher screen.
 *
 * Clickable wherever there is a dashboard to return to, which is every researcher screen except the
 * dashboard itself and the sign-in page. It routes through the same handler as the page's own
 * *Back to dashboard* button rather than navigating to `/`, so the browser-history layer stack it
 * maintains stays in step — a plain link would push an entry and leave Back walking a stale stack.
 */
export function Brand({
  onHome,
  href,
}: {
  onHome?: () => void;
  href?: string;
}) {
  return <BrandMark onHome={onHome} href={href} />;
}

function BrandMark({
  onHome,
  href,
}: {
  onHome?: () => void;
  href?: string;
}) {
  // Pages outside the dashboard (sign-in, sign-up) have no history stack to keep in step, so a
  // plain link back to the landing page is enough.
  if (href) {
    return (
      <Link className="brand brand-link" href={href} aria-label="greCAPTCHA home" title="Home">
        <span className="brand-mark" aria-hidden="true">
          G
        </span>
        greCAPTCHA
      </Link>
    );
  }

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
