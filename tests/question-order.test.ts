import { describe, expect, it } from "vitest";

import { orderQuestions } from "@/lib/quiz";

describe("question order", () => {
  it("orders by type first, then by the page they draw on", () => {
    const questions = [
      { id: "free-method", type: "free_response", sourcePage: 4 },
      { id: "fill-late", type: "fill_blank", sourcePage: 10 },
      { id: "mc-results", type: "multiple_choice", sourcePage: 9 },
      { id: "fill-intro", type: "fill_blank", sourcePage: 1 },
      { id: "free-limits", type: "free_response", sourcePage: 12 },
      { id: "mc-early", type: "multiple_choice", sourcePage: 2 },
    ];
    expect(orderQuestions(questions).map((question) => question.id)).toEqual([
      "mc-early",
      "mc-results",
      "fill-intro",
      "fill-late",
      "free-method",
      "free-limits",
    ]);
  });

  it("keeps generated order on ties and puts unpaged questions last within a type", () => {
    const questions = [
      { id: "unpaged-mc", type: "multiple_choice" },
      { id: "second-on-5", type: "fill_blank", sourcePage: 5 },
      { id: "first-on-2", type: "fill_blank", sourcePage: 2 },
      { id: "third-on-5", type: "fill_blank", sourcePage: 5 },
      { id: "unpaged-fill", type: "fill_blank" },
    ];
    expect(orderQuestions(questions).map((question) => question.id)).toEqual([
      "unpaged-mc",
      "first-on-2",
      "second-on-5",
      "third-on-5",
      "unpaged-fill",
    ]);
    expect(questions[0].id).toBe("unpaged-mc");
  });
});
