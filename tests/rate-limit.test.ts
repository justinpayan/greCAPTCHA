import { expect, it, vi } from "vitest";
import { enforceRateLimit, RateLimitError, rateLimitResponse } from "@/lib/security";

it("reports the remaining wait and permits a retry at the end of the window", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const request = new Request("https://example.org");
    const attempt = () => enforceRateLimit(request, "test-window", "user", 1, 120);
    await attempt();
    vi.advanceTimersByTime(58_500);
    const error = await attempt().catch(caught => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    const response = rateLimitResponse(error);
    expect(response.headers.get("Retry-After")).toBe("62");
    expect(await response.json()).toEqual({ error: "Too many requests. Try again in 1 minute and 2 seconds." });
    vi.advanceTimersByTime(61_500);
    await expect(attempt()).resolves.toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
