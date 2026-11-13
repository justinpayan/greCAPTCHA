import "server-only";

import fs from "node:fs";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { attemptAnswers } from "@/db/schema";
import { loadAttemptContext } from "@/lib/attempts";
import { manuscriptPath, readManuscript, readTemplateMaterial, templateMaterialPath } from "@/lib/manuscripts";
import { getOpenRouterModels } from "@/lib/openrouter";
import { bundleTokens, parseBundle } from "@/lib/code-bundle";
import { countPdfPages } from "@/lib/pdf-title";
import { materialKindOf, type PdfEngine, type QuestionBlockConfig, type StoredQuestion } from "@/lib/quiz";

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
/** A student project's source when the taker has not uploaded theirs yet, in tokens. */
export const TYPICAL_CODE_TOKENS = 40_000;
/**
 * A codebase's tokens at the low end, relative to the stored estimate, which counts three
 * characters a token so as to refuse a codebase too large rather than fail on it; real tokenizers
 * manage closer to four.
 */
const CODE_TOKENS_LOW_SHARE = 0.75;

/**
 * The source material as model input on one request, and what any per-request extraction costs:
 * the PDF's pages, or for a codebase its line-numbered text, which needs no extraction.
 */
function materialInput(
  input: { pages?: number; pdfEngine?: PdfEngine; codeTokens?: number },
  bound: "low" | "high",
): { tokens: number; fee: number } {
  if (input.codeTokens !== undefined) {
    return {
      tokens: bound === "low" ? input.codeTokens * CODE_TOKENS_LOW_SHARE : input.codeTokens,
      fee: 0,
    };
  }
  const pages = input.pages ?? TYPICAL_PAGE_COUNT;
  return {
    tokens: pages * PDF_TOKENS_PER_PAGE[bound],
    fee: pages * (OCR_PRICE_PER_PAGE[input.pdfEngine ?? "native"] ?? 0),
  };
}

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
 * Generating a set: one request per question family, each sending the whole PDF or codebase. The
 * OCR engine, where one is used, is charged per page on each of those requests. `codeTokens`, when
 * given, replaces the PDF: the codebase's size in tokens.
 */
export function generationCost(input: {
  price: ModelPrice;
  blocks: Array<Pick<QuestionBlockConfig, "count" | "candidatePoolSize">>;
  pages: number;
  pdfEngine: PdfEngine;
  codeTokens?: number;
}): CostRange {
  const range = (bound: "low" | "high") => {
    const material = materialInput(input, bound);
    let total = 0;
    let generatedSoFar = 0;
    for (const block of input.blocks) {
      total += cost(
        {
          input:
            material.tokens +
            GENERATION_PROMPT_TOKENS +
            generatedSoFar * PREVIOUS_QUESTION_TOKENS,
          output: block.candidatePoolSize * GENERATED_QUESTION_TOKENS[bound],
        },
        input.price,
      );
      total += material.fee;
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
  pages?: number;
  pdfEngine?: PdfEngine;
  /** For a codebase: its size in tokens, in place of the PDF's pages. */
  codeTokens?: number;
}): CostRange {
  const questions = input.freeResponseBlocks.reduce((sum, count) => sum + count, 0);
  if (questions === 0) return { low: 0, high: 0 };
  const answers =
    input.answerTokens?.reduce((sum, tokens) => sum + tokens, 0) ??
    questions * TYPICAL_ANSWER_TOKENS;
  const range = (bound: "low" | "high") => {
    const material = materialInput(input, bound);
    return (
      cost(
        {
          input:
            input.freeResponseBlocks.length * (GRADING_PROMPT_TOKENS + material.tokens) +
            questions * GRADING_RUBRIC_TOKENS +
            answers,
          output: questions * GRADED_ANSWER_TOKENS[bound],
        },
        input.price,
      ) + input.freeResponseBlocks.length * material.fee
    );
  };
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
  /** For a codebase, its size in tokens in place of pages; `pagesKnown` says whether it is real. */
  codeTokens?: number;
};

/**
 * The estimate for an invitation the taker pays for. When the creator supplied the source
 * material its real page count is used; otherwise a typical paper length is assumed.
 */
export async function invitationCostEstimate(template: {
  id: string;
  materialUploader: string;
  config: {
    modelId: string;
    pdfEngine: PdfEngine;
    blocks: QuestionBlockConfig[];
    materialKind?: "pdf" | "code";
  };
}): Promise<CostEstimate> {
  const details = await modelDetails(template.config.modelId);
  const code = materialKindOf(template.config) === "code";
  let pages: number | null = null;
  let knownCodeTokens: number | null = null;
  if (template.materialUploader === "creator") {
    const materialPath = templateMaterialPath(template.id, code ? "code" : "pdf");
    if (fs.existsSync(materialPath)) {
      if (code) knownCodeTokens = bundleTokens(parseBundle(readTemplateMaterial(template.id, "code")));
      else pages = await countPdfPages(readTemplateMaterial(template.id));
    }
  }
  const pageCount = pages ?? TYPICAL_PAGE_COUNT;
  const codeTokens = code ? (knownCodeTokens ?? TYPICAL_CODE_TOKENS) : undefined;
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
          codeTokens,
        })
      : null,
    grading: details?.price ? gradingCost({ price: details.price, freeResponseBlocks,
      pages: pageCount, pdfEngine: template.config.pdfEngine, codeTokens }) : null,
    pages: pageCount,
    pagesKnown: code ? knownCodeTokens !== null : pages !== null,
    ...(codeTokens !== undefined ? { codeTokens } : {}),
  };
}

/** The estimate for grading one attempt, from its actual free-response answers. */
export async function attemptGradingCostEstimate(attemptId: string): Promise<CostEstimate> {
  const context = await loadAttemptContext(attemptId);
  const code = context.set.materialKind === "code";
  const pages = !code && fs.existsSync(manuscriptPath(context.set.id))
    ? await countPdfPages(readManuscript(context.set.id)) : null;
  const codeTokens = code && fs.existsSync(manuscriptPath(context.set.id, "code"))
    ? bundleTokens(parseBundle(readManuscript(context.set.id, "code"))) : undefined;
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
          pages: pages ?? TYPICAL_PAGE_COUNT,
          pdfEngine: context.set.pdfEngine as PdfEngine,
          codeTokens,
          freeResponseBlocks: [...perBlock.values()],
          answerTokens: gradable.map((question) =>
            tokensForText(responseById.get(question.id) ?? ""),
          ),
        })
      : null,
    pages: pages ?? TYPICAL_PAGE_COUNT,
    pagesKnown: code ? codeTokens !== undefined : pages !== null,
    ...(codeTokens !== undefined ? { codeTokens } : {}),
  };
}
