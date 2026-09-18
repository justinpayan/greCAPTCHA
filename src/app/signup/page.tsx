import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { currentUser } from "@/lib/session";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <LoginForm next={target} signup />;
}
