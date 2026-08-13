import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { quizzes } from "@/db/schema";
import { generateQuizWithOpenRouter, getOpenRouterModels } from "@/lib/openrouter";
import {
  pdfEngineSchema,
  prepareQuestions,
  toPublicQuiz,
} from "@/lib/quiz";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 25 * 1024 * 1024;

function boundedInteger(value: FormDataEntryValue | null, min: number, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Expected a whole number between ${min} and ${max}.`);
  }
  return number;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("paper");
    const contributions = String(form.get("contributions") ?? "").trim();
    const modelId = String(form.get("modelId") ?? "").trim();
    const pdfEngine = pdfEngineSchema.parse(form.get("pdfEngine"));
    const questionCount = boundedInteger(form.get("questionCount"), 1, 30);
    const distractorsPerBlank = boundedInteger(form.get("distractorsPerBlank"), 0, 10);

    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose a PDF manuscript.");
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Only PDF files are supported.");
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new Error("The PDF must be 25 MB or smaller.");
    }
    if (contributions.length < 20 || contributions.length > 10_000) {
      throw new Error("Describe your contributions in 20 to 10,000 characters.");
    }

    const signature = Buffer.from(await file.slice(0, 5).arrayBuffer()).toString("ascii");
    if (signature !== "%PDF-") {
      throw new Error("The selected file does not appear to be a valid PDF.");
    }

    const models = await getOpenRouterModels();
    const selectedModel = models.find((model) => model.id === modelId);
    if (!selectedModel) {
      throw new Error("Choose a model from the current OpenRouter catalog.");
    }
    if (pdfEngine === "native" && !selectedModel.inputModalities.includes("file")) {
      throw new Error("The selected model does not advertise native PDF support.");
    }

    const generated = await generateQuizWithOpenRouter({
      file,
      contributions,
      questionCount,
      distractorsPerBlank,
      modelId,
      pdfEngine,
    });
    const questions = prepareQuestions(generated);
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    await db.insert(quizzes).values({
      id,
      paperName: file.name,
      contributions,
      questionCount,
      distractorsPerBlank,
      modelId,
      pdfEngine,
      questionsJson: JSON.stringify(questions),
      status: "active",
      createdAt,
    });

    return NextResponse.json(
      { quiz: toPublicQuiz(id, file.name, modelId, pdfEngine, questions) },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Question generation failed unexpectedly.";
    const clientError =
      message.startsWith("Choose") ||
      message.startsWith("Only") ||
      message.startsWith("The PDF") ||
      message.startsWith("The selected") ||
      message.startsWith("Describe") ||
      message.startsWith("Expected");
    return NextResponse.json({ error: message }, { status: clientError ? 400 : 502 });
  }
}
