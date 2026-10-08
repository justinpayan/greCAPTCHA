import { describe, expect, it } from "vitest";

import { createDefaultStudyTemplate } from "@/lib/default-study-template";

describe("default study template", () => {
  it("starts new Basic and Advanced configurations with a 30-minute limit", () => {
    expect(createDefaultStudyTemplate("test/model").overallTimeLimitSeconds).toBe(30 * 60);
  });

  it("includes two process-matching fill-in-the-blank questions with two distractors per blank", () => {
    const blocks = createDefaultStudyTemplate("test/model").blocks;
    const processMatching = blocks.find((block) => block.id === "default-process-matching");
    expect(processMatching).toMatchObject({
      type: "fill_blank",
      name: "Process matching",
      count: 2,
      candidatePoolSize: 6,
      distractorsPerBlank: 2,
      warmup: false,
    });
    expect(processMatching?.prompt).toMatch(/^Generate process-matching fill-in-the-blank questions\./);
    expect(blocks.map((block) => block.type)).toEqual([
      "fill_blank",
      "free_response",
      "free_response",
      "free_response",
    ]);
  });
});
