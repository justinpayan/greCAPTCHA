import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/conference-invitation", () => ({ AssessmentInvitation: () => null, ConferenceInvitation: () => null }));
vi.mock("@/lib/session", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/templates", () => ({ getTemplateByInvitationToken: vi.fn(), getInvitationAttempt: vi.fn() }));
vi.mock("@/lib/cost-estimate", () => ({ invitationCostEstimate: vi.fn() }));

import InvitationPage from "@/app/invite/[token]/page";
import ConferencePage from "@/app/conference/[token]/page";
import { currentUser } from "@/lib/session";
import { getInvitationAttempt, getTemplateByInvitationToken } from "@/lib/templates";
import { invitationCostEstimate } from "@/lib/cost-estimate";

describe.each([
  ["invite", InvitationPage],
  ["conference", ConferencePage],
] as const)("returning through /%s", (path, page) => {
  beforeEach(() => vi.resetAllMocks());

  it("redirects to the assigned attempt before estimating or generating another test", async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: "taker", username: "author", usernameNormalized: "author", passwordHash: "test",
      passwordSalt: "test", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    vi.mocked(getTemplateByInvitationToken).mockResolvedValue({ id: "template" } as Awaited<ReturnType<typeof getTemplateByInvitationToken>>);
    vi.mocked(getInvitationAttempt).mockResolvedValue({ attemptId: "completed-attempt" });
    await expect(page({ params: Promise.resolve({ token: "invitation" }) })).rejects.toMatchObject({
      digest: expect.stringContaining("/attempt/completed-attempt"),
    });
    expect(getInvitationAttempt).toHaveBeenCalledWith("template", "taker");
    expect(invitationCostEstimate).not.toHaveBeenCalled();
  });

  it("requires sign-in while preserving the pasted URL", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);
    await expect(page({ params: Promise.resolve({ token: "invitation" }) })).rejects.toMatchObject({
      digest: expect.stringContaining(`/login?next=${encodeURIComponent(`/${path}/invitation`)}`),
    });
    expect(getInvitationAttempt).not.toHaveBeenCalled();
  });
});
