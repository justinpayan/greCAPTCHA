import { redirect } from "next/navigation";

import { ResearchCaptcha } from "@/components/research-captcha";
import { currentUser } from "@/lib/session";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <ResearchCaptcha username={user.username} />;
}
