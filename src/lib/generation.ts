import "server-only";

import fs from "node:fs";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { attempts, conferenceSubmissions, questionSets } from "@/db/schema";
import { createAttempt } from "@/lib/attempts";
import { persistManuscript } from "@/lib/manuscripts";
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
  questionSetOwnerUserId?: string;
  sourceTemplateId?: string | null;
  workflowType?: "course" | "conference";
  conferenceSubmissionId?: string;
  taker?: { id: string; username: string };
  filePath: string;
  fileName: string;
  setName: string;
  contributions: string;
  modelId: string;
  pdfEngine: PdfEngine;
  randomize: boolean;
  overallTimeLimitSeconds: number | null;
  blocks: QuestionBlockConfig[];
};

export async function executeGeneration(
  ownerUserId: string,
  payload: GenerationJobPayload,
  apiKey: string,
  onProgress: (current: number, total: number) => Promise<void>,
) {
  ownerUserId = payload.questionSetOwnerUserId ?? ownerUserId;
  const existingSet = await db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(eq(questionSets.id, payload.questionSetId))
    .get();
  if (existingSet) {
    if (!payload.taker) return { questionSetId: payload.questionSetId };
    const existingAttempt = await db
      .select({ attemptId: attempts.id })
      .from(attempts)
      .where(
        and(
          eq(attempts.questionSetId, payload.questionSetId),
          eq(attempts.takerUserId, payload.taker.id),
        ),
      )
      .get();
    const created =
      existingAttempt ??
      (await createAttempt({
        questionSetId: payload.questionSetId,
        ownerUserId,
        randomize: payload.randomize,
        taker: payload.taker,
      }));
    if (payload.conferenceSubmissionId) {
      await db
        .update(conferenceSubmissions)
        .set({
          questionSetId: payload.questionSetId,
          attemptId: created.attemptId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(conferenceSubmissions.id, payload.conferenceSubmissionId))
        .run();
    }
    return { questionSetId: payload.questionSetId, attemptId: created.attemptId };
  }

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

  // The job upload is temporary. Preserve the exact manuscript used for generation before the
  // question set becomes visible, so every attempt can display the same source document.
  persistManuscript(payload.filePath, payload.questionSetId);
  await db.insert(questionSets).values({
    id: payload.questionSetId,
    ownerUserId,
    sourceTemplateId: payload.sourceTemplateId ?? null,
    workflowType: payload.workflowType ?? "course",
    schemaVersion: 1,
    name: payload.setName || null,
    paperName: payload.fileName,
    contributions: payload.contributions,
    modelId: payload.modelId,
    pdfEngine: payload.pdfEngine,
    overallTimeLimitSeconds: payload.overallTimeLimitSeconds,
    randomize: payload.randomize,
    configJson: JSON.stringify(payload.blocks),
    questionsJson: JSON.stringify(questions),
    createdAt: new Date().toISOString(),
  });
  if (!payload.taker) return { questionSetId: payload.questionSetId };
  const created = await createAttempt({
    questionSetId: payload.questionSetId,
    ownerUserId,
    randomize: payload.randomize,
    taker: payload.taker,
  });
  if (payload.conferenceSubmissionId) {
    await db
      .update(conferenceSubmissions)
      .set({
        questionSetId: payload.questionSetId,
        attemptId: created.attemptId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(conferenceSubmissions.id, payload.conferenceSubmissionId))
      .run();
  }
  return { questionSetId: payload.questionSetId, attemptId: created.attemptId };
}
