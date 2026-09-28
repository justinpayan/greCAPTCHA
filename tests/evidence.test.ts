import { describe, expect, it } from "vitest";

import { locateEvidence, segmentByEvidence } from "@/lib/evidence";

const response =
  "We randomised within blocks to avoid carry-over.\nThe cost is that order effects—between blocks—remain.";

describe("grading evidence", () => {
  it("finds verbatim quotes, and ones copied with different spacing, case or dashes", () => {
    expect(locateEvidence(response, ["randomised within blocks"])).toEqual([{ start: 3, end: 27 }]);
    const [loose] = locateEvidence(response, ["the COST is that order effects-between blocks"]);
    expect(response.slice(loose.start, loose.end)).toBe(
      "The cost is that order effects—between blocks",
    );
  });

  it("drops paraphrases and trivially short quotes, and merges overlaps", () => {
    expect(locateEvidence(response, ["something never written", "We", ""])).toEqual([]);
    expect(locateEvidence(response, ["randomised within", "within blocks"])).toEqual([
      { start: 3, end: 27 },
    ]);
  });

  it("splits the response into pieces tagged with the criteria covering them", () => {
    const text = "alpha beta gamma";
    const segments = segmentByEvidence(text, [
      [{ start: 0, end: 10 }],
      [{ start: 6, end: 16 }],
    ]);
    expect(segments).toEqual([
      { text: "alpha ", criteria: [0] },
      { text: "beta", criteria: [0, 1] },
      { text: " gamma", criteria: [1] },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segmentByEvidence(text, [[]])).toEqual([{ text, criteria: [] }]);
  });
});
