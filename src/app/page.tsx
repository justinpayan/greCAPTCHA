import { LandingPage } from "@/components/landing-page";
import { ResearchCaptcha } from "@/components/research-captcha";
import { getStartedHidden } from "@/lib/preferences";
import { currentUser } from "@/lib/session";

// Signed-in researchers land on their dashboard; everyone else sees the project page.
export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const user = await currentUser();
  if (!user) return <LandingPage />;
  // Read here, before render, so a hidden guide never flashes on screen while the page loads.
  return (
    <ResearchCaptcha
      username={user.username}
      initialMode={(await searchParams).tab === "taken" ? "mine" : "default"}
      initialGetStartedHidden={await getStartedHidden(user.id)}
    />
  );
}
