import { describe, expect, it } from "vitest";
import { proctoringCutoff } from "@/lib/proctoring-clock";

describe("proctored assessment cutoff", () => {
  it("counts an outage once it recovers and includes the 60-second boundary", () => {
    expect(proctoringCutoff(14_999, 90_000, 0, 0, true).recovered).toBe(false);
    expect(proctoringCutoff(15_000, 90_000, 0, 0, false).recovered).toBe(false);
    for (const count of [0, 1, 2]) {
      expect(proctoringCutoff(60_000, 90_000, 0, count, true))
        .toEqual({ cutoff: null, recovered: true, disqualification: null });
    }
    expect(proctoringCutoff(60_001, 90_000, 0, 0, true).disqualification)
      .toBe("Connection lost for more than 60 seconds");
  });

  it("disqualifies at the fourth detection even if a check-in arrives", () => {
    expect(proctoringCutoff(14_999, 90_000, 0, 3, false).cutoff).toBeNull();
    expect(proctoringCutoff(15_000, 90_000, 0, 3, true))
      .toEqual({ cutoff: 15_000, recovered: false, disqualification: "Fourth connection interruption" });
  });

  it("uses the earlier cutoff, treating a tie as the assessment deadline", () => {
    expect(proctoringCutoff(90_000, 15_000, 0, 3, false))
      .toEqual({ cutoff: 15_000, recovered: false, disqualification: null });
    expect(proctoringCutoff(90_000, 15_001, 0, 3, false).disqualification)
      .toBe("Fourth connection interruption");
  });
});
