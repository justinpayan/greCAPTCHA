import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { accountTokens } from "@/db/schema";
import { notFound, redirect } from "next/navigation";
import { AccountSettings } from "@/components/account-settings";
import { currentAccount } from "@/lib/session";

const publicSections = ["verify-email", "forgot-password", "reset-password", "challenge"];
const sections = [...publicSections, "settings", "email", "mfa", "delete", "onboarding"];

export const metadata = { referrer: "no-referrer" };

export default async function AccountPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  if (!publicSections.includes(section)) {
    const account = await currentAccount();
    if (!account) redirect(`/login?next=${encodeURIComponent(`/account/${section}`)}`);
    if (!account.verifiedEmail && !["email", "settings"].includes(section)) redirect("/account/email");
    if (section === "email" && !account.verifiedEmail) {
      const pending = db.select({ email: accountTokens.payload }).from(accountTokens).where(and(
        eq(accountTokens.userId, account.id), eq(accountTokens.authVersion, account.authVersion),
        eq(accountTokens.purpose, "verify"), gt(accountTokens.expiresAt, new Date().toISOString())
      )).orderBy(desc(accountTokens.expiresAt)).get();
      return <AccountSettings section={section} initialVerification pendingEmail={pending?.email ?? ""} />;
    }
  }
  return <AccountSettings key={section} section={section} />;
}
