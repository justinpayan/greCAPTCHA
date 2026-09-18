import { expect, it } from "vitest";

import {
  generateQuestionBlock,
  getOpenRouterModels,
  gradeFreeResponseBlock,
  setOpenRouterTransportForTests,
  validateOpenRouterKey,
} from "@/lib/openrouter";
import type { QuestionBlockConfig, StoredFreeResponseQuestion } from "@/lib/quiz";

const apiKey = process.env.OPENROUTER_TEST_API_KEY ?? "";
const modelId = process.env.OPENROUTER_TEST_MODEL ?? "";
const live = process.env.RUN_LIVE_OPENROUTER_TEST === "1" && apiKey && modelId ? it : it.skip;

function makeSmokePdf() {
  const stream = "BT /F1 18 Tf 72 720 Td (Two plus two is four.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

live("uses a real OpenRouter model only when explicitly enabled", async () => {
  const realFetch = (globalThis as typeof globalThis & { __realFetch?: typeof fetch }).__realFetch;
  if (!realFetch) throw new Error("Native fetch is unavailable.");
  setOpenRouterTransportForTests((input, init) => realFetch(input, init));

  const keyMetadata = await validateOpenRouterKey(apiKey);
  expect(keyMetadata.label).not.toBeUndefined();
  const models = await getOpenRouterModels(apiKey);
  const model = models.find((candidate) => candidate.id === modelId);
  expect(model).toBeTruthy();
  if (!model?.inputModalities.includes("file")) {
    throw new Error("OPENROUTER_TEST_MODEL must support file input for the live smoke test.");
  }
  const generationBlock: QuestionBlockConfig = {
    id: "live-generation",
    type: "multiple_choice",
    name: "Live generation",
    count: 1,
    optionsPerQuestion: 2,
    timeLimitSeconds: null,
    warmup: false,
    prompt: "Create one simple question whose answer is explicitly stated in the document.",
  };
  const generated = await generateQuestionBlock({
    apiKey,
    modelId,
    file: new File([makeSmokePdf()], "smoke.pdf", { type: "application/pdf" }),
    contributions: "Created the entire one-line test document.",
    block: generationBlock,
    previousQuestions: [],
    pdfEngine: "native",
  });
  expect(generated.generated.questions).toHaveLength(1);

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
