import { describe, expect, it } from "vitest";

import { createDefaultStudyBlocks } from "@/lib/default-study-template";
import { generationInstructions, questionBlockSchema } from "@/lib/quiz";

const freeResponse = {
  id: "free",
  type: "free_response" as const,
  name: "",
  count: 1,
  candidatePoolSize: 1,
  warmup: false,
  prompt: "Ask why the study used a paired design.",
};

describe("generation instructions", () => {
  it("sends the question prompt, then the rubric prompt, under their own headings", () => {
    const block = questionBlockSchema.parse({ ...freeResponse, rubricPrompt: "Award 50 points per reason." });
    expect(generationInstructions(block)).toBe(
      "Question generation instructions:\nAsk why the study used a paired design.\n\nRubric generation instructions:\nAward 50 points per reason.",
    );
  });

  it("keeps the single heading for a card saved before rubric prompts existed", () => {
    const block = questionBlockSchema.parse(freeResponse);
    expect(block).toMatchObject({ rubricPrompt: "" });
    expect(generationInstructions(block)).toBe(
      "User-authored generation instructions:\nAsk why the study used a paired design.",
    );
  });

  it("leaves the rubric prompt of every default free-response card empty", () => {
    for (const block of createDefaultStudyBlocks()) {
      if (block.type !== "free_response") continue;
      expect(block.prompt).not.toMatch(/rubric/i);
      expect(block.rubricPrompt).toBe("");
    }
  });
});
