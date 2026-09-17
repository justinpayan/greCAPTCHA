import "server-only";

import { cookies } from "next/headers";

import { accountForSession } from "@/lib/accounts";
import { SESSION_COOKIE } from "@/lib/auth";

export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  return accountForSession(token);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Not authorised.");
  return user;
}

export async function hasResearcherSession(): Promise<boolean> {
  return Boolean(await currentUser());
}
