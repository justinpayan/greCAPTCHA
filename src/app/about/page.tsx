import { LandingPage } from "@/components/landing-page";
import { currentUser } from "@/lib/session";

// The landing page at an address signed-in researchers can reach; `/` shows them their dashboard.
export default async function About() {
  const user = await currentUser();
  return <LandingPage signedIn={Boolean(user)} />;
}
