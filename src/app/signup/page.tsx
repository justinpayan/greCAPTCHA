import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { currentUser } from "@/lib/session";

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  return <LoginForm next="/" signup />;
}
