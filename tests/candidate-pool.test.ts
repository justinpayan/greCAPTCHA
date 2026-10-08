import { describe, expect, it, vi } from "vitest";

import { questionBlockSchema, sampleQuestions } from "@/lib/quiz";

const legacyBlock = {
  id: "legacy",
  type: "free_response" as const,
  name: "Legacy",
  count: 2,
  warmup: false,
  prompt: "Generate questions about distinct concepts in this manuscript.",
};

describe("candidate pools", () => {
  it("normalizes blocks saved before candidate pools to one candidate per retained question", () => {
    expect(questionBlockSchema.parse(legacyBlock).candidatePoolSize).toBe(2);
  });

  it("rejects a candidate pool smaller than the retained question count", () => {
    const parsed = questionBlockSchema.safeParse({
      ...legacyBlock,
      candidatePoolSize: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("samples the requested number without replacement or mutating the candidate pool", () => {
    const candidates = ["a", "b", "c", "d", "e", "f"];
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const selected = sampleQuestions(candidates, 2);
      expect(selected).toEqual(["b", "c"]);
      expect(new Set(selected).size).toBe(2);
      expect(candidates).toEqual(["a", "b", "c", "d", "e", "f"]);
    } finally {
      random.mockRestore();
    }
  });
});
