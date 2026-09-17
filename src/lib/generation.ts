import "server-only";

import fs from "node:fs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { attempts, questionSets } from "@/db/schema";
import { getUserOpenRouterKey } from "@/lib/accounts";
import { createAttempt } from "@/lib/attempts";
import {
  generateQuestionBlock,
  getOpenRouterModels,
} from "@/lib/openrouter";
import {
  prepareFillQuestions,
  prepareFreeResponseQuestions,
  prepareMultipleChoiceQuestions,
  type PdfEngine,
  type QuestionBlockConfig,
  type StoredQuestion,
} from "@/lib/quiz";

export type GenerationJobPayload = {
  questionSetId: string;
  filePath: string;
  fileName: string;
  setName: string;
  contributions: string;
  modelId: string;
  pdfEngine: PdfEngine;
  randomize: boolean;
  countdownHidden: boolean;
  overallTimeLimitSeconds: number | null;
  blocks: QuestionBlockConfig[];
};

export async function executeGeneration(
  ownerUserId: string,
  payload: GenerationJobPayload,
  onProgress: (current: number, total: number) => Promise<void>,
) {
  const existingSet = await db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(eq(questionSets.id, payload.questionSetId))
    .get();
  if (existingSet) {
    const existingAttempt = await db
      .select({ attemptId: attempts.id })
      .from(attempts)
      .where(eq(attempts.questionSetId, payload.questionSetId))
      .get();
    if (existingAttempt) return existingAttempt;
    return createAttempt({
      questionSetId: payload.questionSetId,
      ownerUserId,
      randomize: payload.randomize,
      countdownHidden: payload.countdownHidden,
    });
  }

  const apiKey = await getUserOpenRouterKey(ownerUserId);
  const selectedModel = (await getOpenRouterModels(apiKey)).find(
    (model) => model.id === payload.modelId,
  );
  if (!selectedModel) throw new Error("The selected OpenRouter model is no longer available.");
  if (payload.pdfEngine === "native" && !selectedModel.inputModalities.includes("file")) {
    throw new Error("The selected model does not advertise native PDF support.");
  }

  const bytes = fs.readFileSync(payload.filePath);
  const file = new File([bytes], payload.fileName, { type: "application/pdf" });
  const questions: StoredQuestion[] = [];
  for (let index = 0; index < payload.blocks.length; index += 1) {
    const block = payload.blocks[index];
    const generated = await generateQuestionBlock({
      apiKey,
      file,
      contributions: payload.contributions,
      block,
      previousQuestions: questions,
      modelId: payload.modelId,
      pdfEngine: payload.pdfEngine,
    });
    if (generated.type === "fill_blank") {
      questions.push(...prepareFillQuestions(generated.generated, block));
    } else if (generated.type === "multiple_choice") {
      questions.push(...prepareMultipleChoiceQuestions(generated.generated, block));
    } else {
      questions.push(...prepareFreeResponseQuestions(generated.generated, block));
    }
    await onProgress(index + 1, payload.blocks.length);
  }

  await db.insert(questionSets).values({
    id: payload.questionSetId,
    ownerUserId,
    schemaVersion: 1,
    name: payload.setName || null,
    paperName: payload.fileName,
    contributions: payload.contributions,
    modelId: payload.modelId,
    pdfEngine: payload.pdfEngine,
    overallTimeLimitSeconds: payload.overallTimeLimitSeconds,
    configJson: JSON.stringify(payload.blocks),
    questionsJson: JSON.stringify(questions),
    createdAt: new Date().toISOString(),
  });
  return createAttempt({
    questionSetId: payload.questionSetId,
    ownerUserId,
    randomize: payload.randomize,
    countdownHidden: payload.countdownHidden,
  });
}
