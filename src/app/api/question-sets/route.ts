import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { questionSets } from "@/db/schema";
import { createAttempt } from "@/lib/attempts";
import { listQuestionSets } from "@/lib/catalog";
import {
  generateQuestionBlock,
  getOpenRouterModels,
  usesDirectGemini,
} from "@/lib/openrouter";
import {
  generationConfigSchema,
  pdfEngineSchema,
  prepareFillQuestions,
  prepareFreeResponseQuestions,
  prepareMultipleChoiceQuestions,
  type StoredQuestion,
} from "@/lib/quiz";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Saved sets for the start screen's searchable list. */
export async function GET() {
  try {
    return NextResponse.json({ sets: await listQuestionSets() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list question sets.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

const MAX_PDF_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("paper");
    const contributions = String(form.get("contributions") ?? "").trim();
    const setName = String(form.get("name") ?? "").trim().slice(0, 120);
    const modelId = String(form.get("modelId") ?? "").trim();
    const pdfEngine = pdfEngineSchema.parse(form.get("pdfEngine"));
    const randomize = form.get("randomize") === "true";
    const countdownHidden = form.get("countdownHidden") === "true";
    const blocks = generationConfigSchema.parse(
      JSON.parse(String(form.get("blocks") ?? "[]")),
    );

    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF manuscript.");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF files are supported.");
    }
    if (file.size > MAX_PDF_BYTES) throw new Error("The PDF must be 25 MB or smaller.");
    if (contributions.length < 15 || contributions.length > 10_000) {
      throw new Error("Describe the contributions in 15 to 10,000 characters.");
    }
    if (blocks.reduce((sum, block) => sum + block.count, 0) > 50) {
      throw new Error("A question set may contain at most 50 questions.");
    }

    const signature = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("ascii");
    if (signature !== "%PDF-") throw new Error("The selected file is not a valid PDF.");

    const selectedModel = (await getOpenRouterModels()).find((model) => model.id === modelId);
    if (!selectedModel) throw new Error("Choose a model from the OpenRouter catalog.");
    const effectivePdfEngine = usesDirectGemini(modelId) ? "native" : pdfEngine;
    if (effectivePdfEngine === "native" && !selectedModel.inputModalities.includes("file")) {
      throw new Error("The selected model does not advertise native PDF support.");
    }

    const questions: StoredQuestion[] = [];
    for (const block of blocks) {
      const result = await generateQuestionBlock({
        file,
        contributions,
        block,
        previousQuestions: questions,
        modelId,
        pdfEngine: effectivePdfEngine,
      });
      if (result.type === "fill_blank") {
        questions.push(...prepareFillQuestions(result.generated, block));
      } else if (result.type === "multiple_choice") {
        questions.push(...prepareMultipleChoiceQuestions(result.generated, block));
      } else {
        questions.push(...prepareFreeResponseQuestions(result.generated, block));
      }
    }

    const questionSetId = randomUUID();
    await db.insert(questionSets).values({
      id: questionSetId,
      schemaVersion: 1,
      name: setName || null,
      paperName: file.name,
      contributions,
      modelId,
      pdfEngine: effectivePdfEngine,
      configJson: JSON.stringify(blocks),
      questionsJson: JSON.stringify(questions),
      createdAt: new Date().toISOString(),
    });

    const state = await createAttempt({ questionSetId, randomize, countdownHidden });
    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Question generation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
