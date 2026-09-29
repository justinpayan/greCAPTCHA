import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/change-password-form";
import { currentUser } from "@/lib/session";

export default async function ChangePasswordPage() {
  if (!(await currentUser())) {
    redirect(`/login?next=${encodeURIComponent("/account/password")}`);
  }
  return <ChangePasswordForm />;
}
