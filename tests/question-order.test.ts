import { describe, expect, it } from "vitest";

import { orderQuestionsByPage } from "@/lib/quiz";

describe("question order", () => {
  it("orders questions by the page they draw on, earliest first", () => {
    const questions = [
      { id: "mc-results", sourcePage: 9 },
      { id: "free-method", sourcePage: 4 },
      { id: "fill-intro", sourcePage: 1 },
      { id: "free-limits", sourcePage: 12 },
    ];
    expect(orderQuestionsByPage(questions).map((question) => question.id)).toEqual([
      "fill-intro",
      "free-method",
      "mc-results",
      "free-limits",
    ]);
  });

  it("keeps generated order on ties and puts unpaged questions last", () => {
    const questions = [
      { id: "unpaged" },
      { id: "second-on-5", sourcePage: 5 },
      { id: "first-on-2", sourcePage: 2 },
      { id: "third-on-5", sourcePage: 5 },
    ];
    expect(orderQuestionsByPage(questions).map((question) => question.id)).toEqual([
      "first-on-2",
      "second-on-5",
      "third-on-5",
      "unpaged",
    ]);
    // The input is left as it was.
    expect(questions[0].id).toBe("unpaged");
  });
});
