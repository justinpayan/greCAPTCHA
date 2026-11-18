import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/research-captcha", () => ({ ResearchCaptcha: () => null }));
vi.mock("@/components/landing-page", () => ({ LandingPage: () => null }));
vi.mock("@/lib/session", () => ({ currentUser: vi.fn(), currentAccount: vi.fn() }));
vi.mock("@/lib/preferences", () => ({ getStartedHidden: vi.fn() }));

import Home from "@/app/page";
import { ResearchCaptcha } from "@/components/research-captcha";
import { currentAccount, currentUser } from "@/lib/session";
import { getStartedHidden } from "@/lib/preferences";

describe("dashboard access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getStartedHidden).mockResolvedValue(true);
  });

  it.each([
    [null, false, false],
    ["encrypted-factor", false, false],
    ["encrypted-factor", true, true],
  ])("keeps the original dashboard for factor %s and verified session %s", async (mfaSecret, mfaVerified, allowed) => {
    const user = { id: "test-user", username: "tester", verifiedEmail: "test@example.test", mfaSecret, mfaVerified };
    vi.mocked(currentAccount).mockResolvedValue(user as Awaited<ReturnType<typeof currentAccount>>);
    vi.mocked(currentUser).mockResolvedValue(user as Awaited<ReturnType<typeof currentUser>>);
    const page = await Home({ searchParams: Promise.resolve({ tab: "taken" }) });
    expect(page.type).toBe(ResearchCaptcha);
    expect(page.props).toMatchObject({
      username: "tester", canAdministerTests: allowed, mfaEnrolled: Boolean(mfaSecret),
      initialMode: "mine", initialGetStartedHidden: true,
    });
  });
});
