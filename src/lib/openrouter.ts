import "server-only";

import {
  freeResponseGradesSchema,
  generatedFillSetSchema,
  generatedFreeResponseSetSchema,
  generatedMultipleChoiceSetSchema,
  type PdfEngine,
  type QuestionBlockConfig,
  type StoredFreeResponseQuestion,
  type StoredQuestion,
} from "@/lib/quiz";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

export type OpenRouterModel = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  inputModalities: string[];
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  recommended: boolean;
};

type RawModel = {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

const recommendedPatterns = [
  /anthropic\/claude-(?:sonnet|opus)/i,
  /openai\/gpt-[5-9]/i,
  /google\/gemini-.*pro/i,
  /deepseek\/deepseek/i,
];

export async function getOpenRouterModels(): Promise<OpenRouterModel[]> {
  const response = await fetch(`${OPENROUTER_URL}/models`, {
    headers: process.env.OPENROUTER_API_KEY
      ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
      : undefined,
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model catalog returned ${response.status}.`);
  }

  const payload = (await response.json()) as { data?: RawModel[] };
  const models = (payload.data ?? [])
    .filter(
      (model): model is RawModel & { id: string } =>
        Boolean(model.id) &&
        (model.architecture?.output_modalities ?? ["text"]).includes("text"),
    )
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      description: model.description,
      contextLength: model.context_length,
      inputModalities: model.architecture?.input_modalities ?? ["text"],
      pricing: model.pricing,
      recommended: recommendedPatterns.some((pattern) => pattern.test(model.id)),
    }));

  return models.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const fillResponseJsonSchema = {
  name: "research_captcha_fill_questions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: { type: "string" },
            blanks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  answer: { type: "string" },
                  distractors: { type: "array", items: { type: "string" } },
                },
                required: ["id", "answer", "distractors"],
              },
            },
          },
          required: ["prompt", "blanks"],
        },
      },
    },
    required: ["questions"],
  },
};

const freeResponseJsonSchema = {
  name: "research_captcha_free_response_questions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: { type: "string" },
            rubric: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                criteria: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      criterion: { type: "string" },
                      points: { type: "number" },
                      guidance: { type: "string" },
                    },
                    required: ["criterion", "points", "guidance"],
                  },
                },
              },
              required: ["summary", "criteria"],
            },
          },
          required: ["prompt", "rubric"],
        },
      },
    },
    required: ["questions"],
  },
};

const multipleChoiceJsonSchema = {
  name: "research_captcha_multiple_choice_questions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: { type: "string" },
            answer: { type: "string" },
            distractors: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
          required: ["prompt", "answer", "distractors", "rationale"],
        },
      },
    },
    required: ["questions"],
  },
};

const gradingJsonSchema = {
  name: "research_captcha_free_response_grades",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      grades: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            questionId: { type: "string" },
            score: { type: "number", minimum: 0, maximum: 100 },
            feedback: { type: "string" },
          },
          required: ["questionId", "score", "feedback"],
        },
      },
    },
    required: ["grades"],
  },
};

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: string; text: string } =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("");
  }
  throw new Error("The model returned no text content.");
}

export function usesDirectGemini(modelId: string) {
  return Boolean(process.env.GEMINI_API_KEY) && /^google\/gemini-/i.test(modelId);
}

async function callGeminiDirect(input: {
  modelId: string;
  prompt: string;
  responseSchema: object;
  file?: File;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  if (input.file) {
    const bytes = Buffer.from(await input.file.arrayBuffer());
    parts.unshift({
      inlineData: {
        mimeType: "application/pdf",
        data: bytes.toString("base64"),
      },
    });
  }

  const directModelId = input.modelId
    .slice("google/".length)
    .replace(/:[a-z0-9_-]+$/i, "");
  const schema =
    "schema" in input.responseSchema
      ? (input.responseSchema as { schema: object }).schema
      : input.responseSchema;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(directModelId)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  const payload = (await response.json()) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini returned ${response.status}.`);
  }
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
  if (!text) throw new Error("Gemini returned no text content.");
  try {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) as unknown;
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
}

async function callOpenRouter(input: {
  modelId: string;
  prompt: string;
  responseSchema: object;
  file?: File;
  pdfEngine?: PdfEngine;
}) {
  if (usesDirectGemini(input.modelId)) {
    return callGeminiDirect(input);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
  if (input.file) {
    const bytes = Buffer.from(await input.file.arrayBuffer());
    content.push({
      type: "file",
      file: {
        filename: input.file.name,
        file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
      },
    });
  }

  const response = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "ResearchCAPTCHA",
    },
    body: JSON.stringify({
      model: input.modelId,
      messages: [{ role: "user", content }],
      ...(input.file
        ? {
            plugins: [
              {
                id: "file-parser",
                pdf: { engine: input.pdfEngine },
              },
            ],
          }
        : {}),
      response_format: {
        type: "json_schema",
        json_schema: input.responseSchema,
      },
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenRouter returned ${response.status}.`);
  }

  const text = extractTextContent(payload.choices?.[0]?.message?.content);
  try {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) as unknown;
  } catch {
    throw new Error("The selected model returned malformed JSON.");
  }
}

export async function generateQuestionBlock(input: {
  file: File;
  contributions: string;
  block: QuestionBlockConfig;
  previousQuestions: StoredQuestion[];
  modelId: string;
  pdfEngine: PdfEngine;
}) {
  const previousQuestionContext = input.previousQuestions.map((question) => {
    if (question.type === "fill_blank") {
      return {
        type: question.type,
        prompt: question.segments
          .map((segment) =>
            segment.type === "text" ? segment.value : `{{${segment.blankId}}}`,
          )
          .join(""),
        answers: question.blanks.map((blank) => ({
          blankId: blank.id,
          answer: blank.answer,
        })),
      };
    }
    if (question.type === "multiple_choice") {
      return {
        type: question.type,
        prompt: question.prompt,
        answer: question.options.find((option) => option.id === question.correctOptionId)
          ?.label,
        distractors: question.options
          .filter((option) => option.id !== question.correctOptionId)
          .map((option) => option.label),
      };
    }
    return {
      type: question.type,
      prompt: question.prompt,
      rubric: question.rubric,
    };
  });
  const sharedContext = `You are part of a system that verifies how well a claimed author understands a submitted manuscript.

The author reports these contributions:
${input.contributions}

User-authored generation instructions:
${input.block.prompt}

${
  previousQuestionContext.length
    ? `Questions and answer criteria already generated for this question set:
${JSON.stringify(previousQuestionContext)}

Generate questions that test meaningfully different concepts. Do not repeat or closely paraphrase any prior question, answer, or rubric criterion.`
    : "No questions have been generated for this set yet."
}`;

  if (input.block.type === "fill_blank") {
    const parsed = await callOpenRouter({
      modelId: input.modelId,
      file: input.file,
      pdfEngine: input.pdfEngine,
      responseSchema: fillResponseJsonSchema,
      prompt: `${sharedContext}

Generate exactly ${input.block.count} fill-in-the-blank questions. Provide approximately ${input.block.distractorsPerBlank} distractors per correct answer. Use a unique short ID for each blank and place it exactly once in the prompt as {{blank_id}}. Do not repeat a correct answer as its own distractor. Return only schema-conforming JSON.`,
    });
    const validated = generatedFillSetSchema.parse(parsed);
    if (validated.questions.length !== input.block.count) {
      throw new Error(`The model returned ${validated.questions.length} questions instead of ${input.block.count}.`);
    }
    return { type: "fill_blank" as const, generated: validated };
  }

  if (input.block.type === "multiple_choice") {
    const optionCount = input.block.optionsPerQuestion;
    const parsed = await callOpenRouter({
      modelId: input.modelId,
      file: input.file,
      pdfEngine: input.pdfEngine,
      responseSchema: multipleChoiceJsonSchema,
      prompt: `${sharedContext}

Generate exactly ${input.block.count} multiple-choice questions with exactly one correct answer each. Supply the correct answer plus exactly ${optionCount - 1} distractors, so each question offers ${optionCount} options in total. Never repeat the correct answer as a distractor and never give two options the same meaning. Do not number, letter, or otherwise order the options in their text, and do not refer to options by position in the prompt. Also supply a rationale of one or two sentences explaining why the correct answer is correct; it is shown to the participant only after grading. Return only schema-conforming JSON.`,
    });
    const validated = generatedMultipleChoiceSetSchema.parse(parsed);
    if (validated.questions.length !== input.block.count) {
      throw new Error(`The model returned ${validated.questions.length} questions instead of ${input.block.count}.`);
    }
    for (const question of validated.questions) {
      if (question.distractors.length !== optionCount - 1) {
        throw new Error(
          `A generated question offers ${question.distractors.length + 1} options instead of ${optionCount}.`,
        );
      }
    }
    return { type: "multiple_choice" as const, generated: validated };
  }

  const parsed = await callOpenRouter({
    modelId: input.modelId,
    file: input.file,
    pdfEngine: input.pdfEngine,
    responseSchema: freeResponseJsonSchema,
    prompt: `${sharedContext}

Generate exactly ${input.block.count} free-response questions. Every rubric must total exactly 100 points across its criteria and permit substantively equivalent wording. Return only schema-conforming JSON.`,
  });
  const validated = generatedFreeResponseSetSchema.parse(parsed);
  if (validated.questions.length !== input.block.count) {
    throw new Error(`The model returned ${validated.questions.length} questions instead of ${input.block.count}.`);
  }
  for (const question of validated.questions) {
    const total = question.rubric.criteria.reduce((sum, criterion) => sum + criterion.points, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new Error(`A generated free-response rubric totals ${total} points instead of 100.`);
    }
  }
  return { type: "free_response" as const, generated: validated };
}

export async function gradeFreeResponseBlock(input: {
  modelId: string;
  questions: StoredFreeResponseQuestion[];
  answers: Record<string, string>;
}) {
  const gradingItems = input.questions.map((question) => ({
    questionId: question.id,
    prompt: question.prompt,
    rubric: question.rubric,
    response: input.answers[question.id] ?? "",
  }));
  const parsed = await callOpenRouter({
    modelId: input.modelId,
    responseSchema: gradingJsonSchema,
    prompt: `Grade each submitted response against only its supplied rubric. Apply criteria consistently, allow substantively equivalent wording, and provide concise actionable feedback. Return one 0–100 score and feedback string for every question ID. Do not omit or add IDs.

Questions, rubrics, and responses:
${JSON.stringify(gradingItems)}`,
  });
  const validated = freeResponseGradesSchema.parse(parsed);
  const expectedIds = new Set(input.questions.map((question) => question.id));
  if (
    validated.grades.length !== expectedIds.size ||
    validated.grades.some((grade) => !expectedIds.has(grade.questionId))
  ) {
    throw new Error("The grading model returned an incomplete or mismatched grade set.");
  }
  return validated;
}
