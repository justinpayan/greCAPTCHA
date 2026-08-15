import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { questionSets } from "@/db/schema";
import { createAttempt } from "@/lib/attempts";
import { generateQuestionBlock, getOpenRouterModels } from "@/lib/openrouter";
import {
  generationConfigSchema,
  pdfEngineSchema,
  prepareFillQuestions,
  prepareFreeResponseQuestions,
  type StoredQuestion,
} from "@/lib/quiz";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("paper");
    const contributions = String(form.get("contributions") ?? "").trim();
    const modelId = String(form.get("modelId") ?? "").trim();
    const pdfEngine = pdfEngineSchema.parse(form.get("pdfEngine"));
    const randomize = form.get("randomize") === "true";
    const blocks = generationConfigSchema.parse(
      JSON.parse(String(form.get("blocks") ?? "[]")),
    );

    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF manuscript.");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF files are supported.");
    }
    if (file.size > MAX_PDF_BYTES) throw new Error("The PDF must be 25 MB or smaller.");
    if (contributions.length < 20 || contributions.length > 10_000) {
      throw new Error("Describe your contributions in 20 to 10,000 characters.");
    }
    if (blocks.reduce((sum, block) => sum + block.count, 0) > 50) {
      throw new Error("A question set may contain at most 50 questions.");
    }

    const signature = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("ascii");
    if (signature !== "%PDF-") throw new Error("The selected file is not a valid PDF.");

    const selectedModel = (await getOpenRouterModels()).find((model) => model.id === modelId);
    if (!selectedModel) throw new Error("Choose a model from the OpenRouter catalog.");
    if (pdfEngine === "native" && !selectedModel.inputModalities.includes("file")) {
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
        pdfEngine,
      });
      questions.push(
        ...(result.type === "fill_blank"
          ? prepareFillQuestions(result.generated, block.id)
          : prepareFreeResponseQuestions(result.generated, block.id)),
      );
    }

    const questionSetId = randomUUID();
    await db.insert(questionSets).values({
      id: questionSetId,
      schemaVersion: 1,
      paperName: file.name,
      contributions,
      modelId,
      pdfEngine,
      configJson: JSON.stringify(blocks),
      questionsJson: JSON.stringify(questions),
      createdAt: new Date().toISOString(),
    });

    const state = await createAttempt(questionSetId, randomize);
    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Question generation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
