import { LandingPage } from "@/components/landing-page";
import { ResearchCaptcha } from "@/components/research-captcha";
import { currentUser } from "@/lib/session";

// Signed-in researchers land on their dashboard; everyone else sees the project page.
export default async function Home() {
  const user = await currentUser();
  if (!user) return <LandingPage />;
  return <ResearchCaptcha username={user.username} />;
}
