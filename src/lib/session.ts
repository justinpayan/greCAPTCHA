import { hasFactor } from "@/lib/account-security";
import "server-only";

import { cookies } from "next/headers";
import { accountForSession } from "@/lib/accounts";
import { SESSION_COOKIE } from "@/lib/auth";

export async function currentAccount() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  return accountForSession(token);
}

export async function currentUser() {
  const account = await currentAccount();
  return account?.verifiedEmail ? account : null;
}

export async function requireUser() {
  const account = await currentAccount();
  if (!account) throw new Error("Not authorised.");
  if (!account.verifiedEmail) throw new Error("Verify your email in Settings before continuing.");
  return account;
}

export async function requireTestAdministrator() {
  const account = await requireUser();
  if (!hasFactor(account) || !account.mfaVerified) throw new Error("Complete multifactor authentication in Settings to access test administration.");
  return account;
}

export async function hasResearcherSession(): Promise<boolean> {
  const account = await currentUser();
  return Boolean(account && account.mfaVerified && hasFactor(account));
}
