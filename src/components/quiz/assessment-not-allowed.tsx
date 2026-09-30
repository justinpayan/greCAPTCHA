import { Brand } from "@/components/brand";

/**
 * Shown when a signed-in account is not on a test's allowlist.
 * Does not name anyone who is allowed.
 */
export function AssessmentNotAllowed({ username }: { username: string }) {
  return (
    <main className="app-shell dashboard-shell">
      <Brand href="/" demoBadge />
      <section>
        <p className="eyebrow">Not allowed</p>
        <h1>You aren&apos;t allowed to take this assessment.</h1>
        <p className="lede">
          Signed in as {username || "your account"}. This assessment is limited to a
          specific list of accounts, and that username is not on the list.
        </p>
        <p className="lede">
          Contact the person who sent you this link if you think this is a mistake.
        </p>
      </section>
    </main>
  );
}
