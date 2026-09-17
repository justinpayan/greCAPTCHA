import { expect, it } from "vitest";

import {
  getOpenRouterModels,
  gradeFreeResponseBlock,
  setOpenRouterTransportForTests,
} from "@/lib/openrouter";
import type { StoredFreeResponseQuestion } from "@/lib/quiz";

const apiKey = process.env.OPENROUTER_TEST_API_KEY ?? "";
const modelId = process.env.OPENROUTER_TEST_MODEL ?? "";
const live = process.env.RUN_LIVE_OPENROUTER_TEST === "1" && apiKey && modelId ? it : it.skip;

live("uses a real OpenRouter model only when explicitly enabled", async () => {
  const realFetch = (globalThis as typeof globalThis & { __realFetch?: typeof fetch }).__realFetch;
  if (!realFetch) throw new Error("Native fetch is unavailable.");
  setOpenRouterTransportForTests((input, init) => realFetch(input, init));

  const models = await getOpenRouterModels(apiKey);
  expect(models.some((model) => model.id === modelId)).toBe(true);
  const question = {
    id: "live-smoke-question",
    blockId: "live-smoke",
    blockName: "Live smoke",
    type: "free_response",
    prompt: "What number is two plus two?",
    description: "Minimal live grading check.",
    warmup: false,
    timeLimitSeconds: null,
    rubric: {
      summary: "The response says four.",
      criteria: [{ criterion: "Correct value", points: 100, guidance: "Award full credit for 4." }],
    },
  } as StoredFreeResponseQuestion;
  const result = await gradeFreeResponseBlock({
    apiKey,
    modelId,
    questions: [question],
    answers: { [question.id]: "4" },
  });
  expect(result.grades).toHaveLength(1);
});
