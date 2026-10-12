import { afterEach, describe, expect, it, vi } from "vitest";

import { gradeFreeResponseBlock } from "@/lib/openrouter";
import type { StoredFreeResponseQuestion } from "@/lib/quiz";

const question = {
  id: "q1",
  type: "free_response",
  blockId: "free",
  prompt: "Explain the main contribution.",
  rubric: {
    summary: "Names the contribution.",
    criteria: [{ criterion: "Correct contribution", points: 100, guidance: "Accept equivalents." }],
  },
} as unknown as StoredFreeResponseQuestion;

/** Grades one answer against a stubbed provider and returns the prompt it was sent. */
async function gradingPrompt(gradingInstructions?: string) {
  let prompt = "";
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: Array<{ text?: string }> }>;
    };
    prompt = body.messages[0].content.find((part) => part.text)?.text ?? "";
    const grades = {
      grades: [{
        questionId: "q1",
        feedback: "Correct.",
        criteria: [{ criterionIndex: 0, pointsAwarded: 100, justification: "Named.", evidence: [] }],
      }],
    };
    return Response.json({ choices: [{ message: { content: JSON.stringify(grades) } }] });
  });
  await gradeFreeResponseBlock({
    apiKey: "sk-or-test",
    modelId: "test/model",
    questions: [question],
    answers: { q1: "The main contribution." },
    gradingInstructions,
  });
  return prompt;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("grading instructions", () => {
  it("sends the creator's instructions with the grading request, before the responses", async () => {
    const prompt = await gradingPrompt("  Do not penalise note-form answers.  ");
    expect(prompt).toContain("grading instructions, which apply to every question");
    expect(prompt).toContain("\nDo not penalise note-form answers.\n");
    expect(prompt.indexOf("Do not penalise")).toBeLessThan(
      prompt.indexOf("Questions, rubrics, and responses:"),
    );
  });

  it("leaves the request unchanged when there are none", async () => {
    expect(await gradingPrompt("   ")).not.toContain("grading instructions");
    expect(await gradingPrompt()).not.toContain("grading instructions");
  });
});
