import "server-only";

import { generatedQuizSchema, type PdfEngine } from "@/lib/quiz";

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

function buildPrompt(
  contributions: string,
  questionCount: number,
  distractorsPerBlank: number,
): string {
  return `You are part of a system that verifies how well a claimed author understands a submitted manuscript.

The author reports these contributions:
${contributions}

Generate exactly ${questionCount} fill-in-the-blank questions about the attached research article.

Requirements:
- Ask only questions this author should reasonably answer given the stated contributions.
- The questions should be very difficult for someone who does not understand the research article, but should be fairly simple for someone who does.
- Do not ask questions where the answer can be inferred from fairly obvious context clues in the question and/or common sense reasoning.
- Every blank must have one objectively correct word or short phrase.
- Multiple blanks in a question are allowed.
- Require conceptual understanding, not mathematical calculations.
- Do not make questions easy to answer through keyword search in the paper. You should not be able to just search terms in the question and find a sentence stating the answer. You should not be able to search the distractors and find that only one appears in the paper and must be the correct answer.
- Do not telegraph answers through grammar or unrelated syntax; use "a/an" before a blank where needed.
- For every correct answer, provide approximately ${distractorsPerBlank} plausible distractors.
- Every distractor for a blank must fit grammatically but remain objectively wrong.
- Do not repeat an answer as its own distractor.
- Use a unique short ID for every blank within its question.
- Insert each blank into the prompt exactly once using {{blank_id}} syntax.

Return only JSON that conforms to the supplied schema.`;
}

const responseJsonSchema = {
  name: "research_captcha_quiz",
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

export async function generateQuizWithOpenRouter(input: {
  file: File;
  contributions: string;
  questionCount: number;
  distractorsPerBlank: number;
  modelId: string;
  pdfEngine: PdfEngine;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const fileBytes = Buffer.from(await input.file.arrayBuffer());
  const fileData = `data:application/pdf;base64,${fileBytes.toString("base64")}`;

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
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildPrompt(
                input.contributions,
                input.questionCount,
                input.distractorsPerBlank,
              ),
            },
            {
              type: "file",
              file: {
                filename: input.file.name,
                file_data: fileData,
              },
            },
          ],
        },
      ],
      plugins: [
        {
          id: "file-parser",
          pdf: { engine: input.pdfEngine },
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: responseJsonSchema,
      },
      temperature: 0.3,
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
  } catch {
    throw new Error("The selected model returned malformed JSON.");
  }

  const validated = generatedQuizSchema.parse(parsed);
  if (validated.questions.length !== input.questionCount) {
    throw new Error(
      `The model returned ${validated.questions.length} questions instead of ${input.questionCount}.`,
    );
  }
  return validated;
}
