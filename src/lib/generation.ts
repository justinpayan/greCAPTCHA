import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { attempts, conferenceSubmissions, questionSets } from "@/db/schema";
import { createAttempt } from "@/lib/attempts";
import { readEncryptedFile } from "@/lib/data-encryption";
import { serializeAllowlist } from "@/lib/allowlist";
import { persistManuscript } from "@/lib/manuscripts";
import { extractPdfTitle } from "@/lib/pdf-title";
import {
  generateQuestionBlock,
  getOpenRouterModels,
} from "@/lib/openrouter";
import {
  orderQuestions,
  type ApiKeyPayer,
  type MaterialUploader,
  prepareFillQuestions,
  prepareFreeResponseQuestions,
  prepareMultipleChoiceQuestions,
  sampleQuestions,
  type PdfEngine,
  type QuestionBlockConfig,
  type StoredQuestion,
} from "@/lib/quiz";

export type GenerationJobPayload = {
  questionSetId: string;
  questionSetOwnerUserId?: string;
  sourceTemplateId?: string | null;
  apiKeyPayer: ApiKeyPayer;
  materialUploader: MaterialUploader;
  credentialOwnerUserId?: string;
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
  takerAllowlist?: string[] | null;
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

  const bytes = readEncryptedFile(payload.filePath, "job-upload");
  const file = new File([new Uint8Array(bytes)], payload.fileName, {
    type: "application/pdf",
  });
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
      questions.push(
        ...sampleQuestions(prepareFillQuestions(generated.generated, block), block.count),
      );
    } else if (generated.type === "multiple_choice") {
      questions.push(
        ...sampleQuestions(prepareMultipleChoiceQuestions(generated.generated, block), block.count),
      );
    } else {
      questions.push(
        ...sampleQuestions(prepareFreeResponseQuestions(generated.generated, block), block.count),
      );
    }
    await onProgress(index + 1, payload.blocks.length);
  }

  // The job upload is temporary. Preserve the exact manuscript used for generation before the
  // question set becomes visible, so every attempt can display the same source document.
  persistManuscript(payload.filePath, payload.questionSetId);
  // Read once here rather than on every attempt load; null when the PDF declares no usable title.
  const paperTitle = await extractPdfTitle(bytes);
  await db.insert(questionSets).values({
    id: payload.questionSetId,
    ownerUserId,
    sourceTemplateId: payload.sourceTemplateId ?? null,
    apiKeyPayer: payload.apiKeyPayer,
    materialUploader: payload.materialUploader,
    schemaVersion: 1,
    name: payload.setName || null,
    paperName: payload.fileName,
    paperTitle,
    contributions: payload.contributions,
    modelId: payload.modelId,
    pdfEngine: payload.pdfEngine,
    overallTimeLimitSeconds: payload.overallTimeLimitSeconds,
    randomize: false,
    configJson: JSON.stringify(payload.blocks),
    questionsJson: JSON.stringify(orderQuestions(questions)),
    takerAllowlistJson: serializeAllowlist(payload.takerAllowlist ?? null),
    createdAt: new Date().toISOString(),
  });
  if (!payload.taker) return { questionSetId: payload.questionSetId };
  const created = await createAttempt({
    questionSetId: payload.questionSetId,
    ownerUserId,
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
