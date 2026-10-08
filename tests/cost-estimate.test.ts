import { describe, expect, it } from "vitest";

import { generationCost, gradingCost, tokensForText } from "@/lib/cost-estimate";

// $1.25 per million input tokens and $10 per million output tokens.
const price = { promptPerToken: 1.25e-6, completionPerToken: 10e-6 };
const studyBlocks = [
  { count: 2, candidatePoolSize: 6 },
  { count: 2, candidatePoolSize: 6 },
  { count: 2, candidatePoolSize: 6 },
  { count: 2, candidatePoolSize: 6 },
];

describe("cost estimates", () => {
  it("gives a plausible range for generating the study's eight questions", () => {
    const range = generationCost({ price, blocks: studyBlocks, pages: 20, pdfEngine: "native" });
    expect(range.low).toBeGreaterThan(0.05);
    expect(range.high).toBeLessThan(1);
    expect(range.high).toBeGreaterThan(range.low);
  });

  it("scales with manuscript length and adds the OCR charge per request", () => {
    const short = generationCost({ price, blocks: studyBlocks, pages: 10, pdfEngine: "native" });
    const long = generationCost({ price, blocks: studyBlocks, pages: 40, pdfEngine: "native" });
    expect(long.low).toBeGreaterThan(short.low);
    const ocr = generationCost({ price, blocks: studyBlocks, pages: 10, pdfEngine: "mistral-ocr" });
    // Four requests, each OCR-ing ten pages at $0.002 a page.
    expect(ocr.low - short.low).toBeCloseTo(4 * 10 * 0.002, 6);
  });

  it("scales generation output cost with the candidate pool, not retained count", () => {
    const direct = generationCost({
      price,
      blocks: [{ count: 2, candidatePoolSize: 2 }],
      pages: 20,
      pdfEngine: "native",
    });
    const pooled = generationCost({
      price,
      blocks: [{ count: 2, candidatePoolSize: 6 }],
      pages: 20,
      pdfEngine: "native",
    });
    expect(pooled.low).toBeGreaterThan(direct.low);
    expect(pooled.high).toBeGreaterThan(direct.high);
  });

  it("charges nothing to grade when there are no free responses", () => {
    expect(gradingCost({ price, freeResponseBlocks: [] })).toEqual({ low: 0, high: 0 });
  });

  it("grows the grading estimate with the length of the answers", () => {
    const brief = gradingCost({ price, freeResponseBlocks: [2], answerTokens: [50, 50] });
    const lengthy = gradingCost({ price, freeResponseBlocks: [2], answerTokens: [2_000, 2_000] });
    expect(lengthy.low).toBeGreaterThan(brief.low);
    expect(tokensForText("abcdefgh")).toBe(2);
  });
});
