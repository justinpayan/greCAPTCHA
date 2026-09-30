import "server-only";

import fs from "node:fs";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers } from "@/db/schema";
import { loadAttemptContext } from "@/lib/attempts";
import { templateMaterialPath } from "@/lib/manuscripts";
import { getOpenRouterModels } from "@/lib/openrouter";
import { countPdfPages } from "@/lib/pdf-title";
import type { PdfEngine, QuestionBlockConfig, StoredQuestion } from "@/lib/quiz";

/**
 * Rough OpenRouter cost estimates for a test taker who pays with their own key.
 *
 * Only an estimate, and shown as a range: the real cost depends on how the provider reads the
 * PDF (as text or as page images), how long the answers are, and, for reasoning models, how much
 * the model thinks before answering, none of which is known in advance. The ranges are built from
 * the model's published per-token prices and the token counts below, which are deliberately
 * generous at the high end so a taker is not surprised by the bill.
 */

/** A PDF page as model input: roughly a page of text at the low end, a page image at the high. */
const PDF_TOKENS_PER_PAGE = { low: 700, high: 1_600 };
/** The manuscript length assumed when the taker has not uploaded theirs yet. */
export const TYPICAL_PAGE_COUNT = 20;
/** Generation instructions, the contribution statement, and the questions made so far. */
const GENERATION_PROMPT_TOKENS = 2_500;
const PREVIOUS_QUESTION_TOKENS = 350;
/** Output for one generated question; the high end allows for a reasoning model's thinking. */
const GENERATED_QUESTION_TOKENS = { low: 350, high: 1_500 };
/** Grading instructions plus, per question, its rubric; answers are counted separately. */
const GRADING_PROMPT_TOKENS = 1_000;
const GRADING_RUBRIC_TOKENS = 450;
/** A free-response answer when it has not been written yet. */
const TYPICAL_ANSWER_TOKENS = 400;
/** Output for grading one answer: per-criterion marks, reasons, and quoted evidence. */
const GRADED_ANSWER_TOKENS = { low: 350, high: 1_400 };
/** OpenRouter's OCR plug-in charge per page, paid on every request that sends the PDF. */
const OCR_PRICE_PER_PAGE: Partial<Record<PdfEngine, number>> = { "mistral-ocr": 0.002 };

export type ModelPrice = { promptPerToken: number; completionPerToken: number };
export type CostRange = { low: number; high: number };

type Tokens = { input: number; output: number };

function cost(tokens: Tokens, price: ModelPrice) {
  return tokens.input * price.promptPerToken + tokens.output * price.completionPerToken;
}

/**
 * Generating a set: one request per question family, each sending the whole PDF. The OCR engine,
 * where one is used, is charged per page on each of those requests.
 */
export function generationCost(input: {
  price: ModelPrice;
  blocks: Array<Pick<QuestionBlockConfig, "count">>;
  pages: number;
  pdfEngine: PdfEngine;
}): CostRange {
  const range = (bound: "low" | "high") => {
    let total = 0;
    let generatedSoFar = 0;
    for (const block of input.blocks) {
      total += cost(
        {
          input:
            input.pages * PDF_TOKENS_PER_PAGE[bound] +
            GENERATION_PROMPT_TOKENS +
            generatedSoFar * PREVIOUS_QUESTION_TOKENS,
          output: block.count * GENERATED_QUESTION_TOKENS[bound],
        },
        input.price,
      );
      total += input.pages * (OCR_PRICE_PER_PAGE[input.pdfEngine] ?? 0);
      generatedSoFar += block.count;
    }
    return total;
  };
  return { low: range("low"), high: range("high") };
}

/**
 * Grading: only free responses go to the model, one request per question family; multiple
 * choice and fill in the blank are marked without it. `answerTokens` lists each free response's
 * length, or leave it out to assume typical answers.
 */
export function gradingCost(input: {
  price: ModelPrice;
  /** Free-response question counts, one entry per family that has any. */
  freeResponseBlocks: number[];
  answerTokens?: number[];
}): CostRange {
  const questions = input.freeResponseBlocks.reduce((sum, count) => sum + count, 0);
  if (questions === 0) return { low: 0, high: 0 };
  const answers =
    input.answerTokens?.reduce((sum, tokens) => sum + tokens, 0) ??
    questions * TYPICAL_ANSWER_TOKENS;
  const range = (bound: "low" | "high") =>
    cost(
      {
        input:
          input.freeResponseBlocks.length * GRADING_PROMPT_TOKENS +
          questions * GRADING_RUBRIC_TOKENS +
          answers,
        output: questions * GRADED_ANSWER_TOKENS[bound],
      },
      input.price,
    );
  return { low: range("low"), high: range("high") };
}

/** About four characters to a token, for English prose. */
export function tokensForText(text: string) {
  return Math.ceil(text.length / 4);
}

type CatalogEntry = { name: string; price: ModelPrice | null };
let catalogCache: { at: number; models: Map<string, CatalogEntry> } | null = null;
const CATALOG_TTL_MS = 30 * 60 * 1_000;

/**
 * A model's display name and per-token prices, from OpenRouter's public catalog. Cached, since
 * prices change rarely and the pages asking for them are opened often; null when the catalog
 * cannot be reached or does not list the model, in which case no estimate is shown.
 */
export async function modelDetails(modelId: string): Promise<CatalogEntry | null> {
  if (!catalogCache || Date.now() - catalogCache.at > CATALOG_TTL_MS) {
    try {
      const models = await getOpenRouterModels();
      catalogCache = {
        at: Date.now(),
        models: new Map(
          models.map((model) => {
            const prompt = Number(model.pricing?.prompt);
            const completion = Number(model.pricing?.completion);
            const price =
              Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
                ? { promptPerToken: prompt, completionPerToken: completion }
                : null;
            return [model.id, { name: model.name, price }];
          }),
        ),
      };
    } catch {
      return null;
    }
  }
  return catalogCache.models.get(modelId) ?? null;
}

/** What a test taker is told before paying: the model, and what generating and grading cost. */
export type CostEstimate = {
  modelId: string;
  /** The catalog's display name, or the ID when the catalog was unavailable. */
  modelName: string;
  /** Null when the model's prices are not known, in which case only the model is shown. */
  generation: CostRange | null;
  grading: CostRange | null;
  /** The page count the generation estimate uses, and whether it is the real manuscript's. */
  pages: number;
  pagesKnown: boolean;
};

/**
 * The estimate for an invitation the taker pays for. When the creator supplied the source
 * material its real page count is used; otherwise a typical paper length is assumed.
 */
export async function invitationCostEstimate(template: {
  id: string;
  materialUploader: string;
  config: { modelId: string; pdfEngine: PdfEngine; blocks: QuestionBlockConfig[] };
}): Promise<CostEstimate> {
  const details = await modelDetails(template.config.modelId);
  let pages: number | null = null;
  if (template.materialUploader === "creator") {
    const materialPath = templateMaterialPath(template.id);
    if (fs.existsSync(materialPath)) pages = await countPdfPages(fs.readFileSync(materialPath));
  }
  const pageCount = pages ?? TYPICAL_PAGE_COUNT;
  const freeResponseBlocks = template.config.blocks
    .filter((block) => block.type === "free_response")
    .map((block) => block.count);
  return {
    modelId: template.config.modelId,
    modelName: details?.name ?? template.config.modelId,
    generation: details?.price
      ? generationCost({
          price: details.price,
          blocks: template.config.blocks,
          pages: pageCount,
          pdfEngine: template.config.pdfEngine,
        })
      : null,
    grading: details?.price ? gradingCost({ price: details.price, freeResponseBlocks }) : null,
    pages: pageCount,
    pagesKnown: pages !== null,
  };
}

/** The estimate for grading one attempt, from its actual free-response answers. */
export async function attemptGradingCostEstimate(attemptId: string): Promise<CostEstimate> {
  const context = await loadAttemptContext(attemptId);
  const details = await modelDetails(context.set.modelId);
  const answers = await db
    .select({ questionId: attemptAnswers.questionId, answerJson: attemptAnswers.answerJson })
    .from(attemptAnswers)
    .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.skipped, false)));
  const responseById = new Map(
    answers.map((answer) => [
      answer.questionId,
      (JSON.parse(answer.answerJson ?? "{}") as { response?: string }).response ?? "",
    ]),
  );
  // Only answered free responses are sent to the grader, grouped by question family.
  const gradable = context.questions.filter(
    (question: StoredQuestion) =>
      question.type === "free_response" && (responseById.get(question.id) ?? "").trim(),
  );
  const perBlock = new Map<string, number>();
  for (const question of gradable) {
    perBlock.set(question.blockId, (perBlock.get(question.blockId) ?? 0) + 1);
  }
  return {
    modelId: context.set.modelId,
    modelName: details?.name ?? context.set.modelId,
    generation: null,
    grading: details?.price
      ? gradingCost({
          price: details.price,
          freeResponseBlocks: [...perBlock.values()],
          answerTokens: gradable.map((question) =>
            tokensForText(responseById.get(question.id) ?? ""),
          ),
        })
      : null,
    pages: 0,
    pagesKnown: false,
  };
}
