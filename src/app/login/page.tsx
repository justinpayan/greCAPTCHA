import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { currentAccount } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const account = await currentAccount();
  if (account) redirect(account.verifiedEmail ? "/" : "/account/email");
  const { next } = await searchParams;
  // Only same-origin paths, so the redirect cannot be pointed at another site.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <LoginForm next={target} />;
}
