import { z } from "zod";

export const pdfEngines = ["cloudflare-ai", "mistral-ocr", "native"] as const;
export const pdfEngineSchema = z.enum(pdfEngines);
export type PdfEngine = z.infer<typeof pdfEngineSchema>;

export const DEFAULT_FILL_PROMPT = `Generate fill-in-the-blank questions that verify how well a claimed author understands the submitted manuscript.

Ask only questions the author should reasonably answer given their stated contributions. Questions should be difficult for someone who does not understand the work but straightforward for someone who does. Require conceptual understanding rather than calculations. Do not make answers discoverable through obvious keyword searches, context clues, common sense, grammar, or whether a word appears in the paper. Every blank must have one objectively correct word or short phrase. Multiple blanks are allowed. Use "a/an" where needed to avoid telegraphing an answer. Distractors must fit grammatically and be plausible but objectively wrong.`;

export const DEFAULT_FREE_RESPONSE_PROMPT = `Generate free-response questions that verify the author's conceptual understanding of the manuscript in areas connected to their stated contributions.

Questions should be difficult for someone who did not contribute to or deeply understand the work, but answerable without calculations by a genuine contributor. Avoid requests that can be answered by copying a sentence from the paper. For each question, construct an objective 100-point rubric with explicit criteria, point allocations, and guidance about what evidence earns full, partial, or no credit. Allow substantively equivalent wording and multiple valid explanations where appropriate. The rubric must support consistent grading without requiring exact phrasing.`;

const blockBase = {
  id: z.string().min(1).max(100),
  count: z.number().int().min(1).max(30),
  prompt: z.string().min(20).max(20_000),
};

export const questionBlockSchema = z.discriminatedUnion("type", [
  z.object({
    ...blockBase,
    type: z.literal("fill_blank"),
    distractorsPerBlank: z.number().int().min(0).max(10),
  }),
  z.object({
    ...blockBase,
    type: z.literal("free_response"),
  }),
]);

export const generationConfigSchema = z.array(questionBlockSchema).min(1).max(20);
export type QuestionBlockConfig = z.infer<typeof questionBlockSchema>;

const generatedBlankSchema = z.object({
  id: z.string().min(1),
  answer: z.string().min(1),
  distractors: z.array(z.string().min(1)),
});

export const generatedFillSetSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string().min(1),
      blanks: z.array(generatedBlankSchema).min(1),
    }),
  ),
});

const rubricCriterionSchema = z.object({
  criterion: z.string().min(1),
  points: z.number().min(0).max(100),
  guidance: z.string().min(1),
});

export const generatedFreeResponseSetSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string().min(1),
      rubric: z.object({
        summary: z.string().min(1),
        criteria: z.array(rubricCriterionSchema).min(1),
      }),
    }),
  ),
});

export const freeResponseGradesSchema = z.object({
  grades: z.array(
    z.object({
      questionId: z.string().min(1),
      score: z.number().min(0).max(100),
      feedback: z.string().min(1),
    }),
  ),
});

export type GeneratedFillSet = z.infer<typeof generatedFillSetSchema>;
export type GeneratedFreeResponseSet = z.infer<typeof generatedFreeResponseSetSchema>;
export type FreeResponseGrades = z.infer<typeof freeResponseGradesSchema>;

export type QuizChoice = { id: string; label: string };

export type QuestionSegment =
  | { type: "text"; value: string }
  | { type: "blank"; blankId: string };

export type StoredBlank = {
  id: string;
  answer: string;
  correctChoiceId: string;
};

export type StoredFillQuestion = {
  type: "fill_blank";
  id: string;
  blockId: string;
  segments: QuestionSegment[];
  choices: QuizChoice[];
  blanks: StoredBlank[];
};

export type Rubric = {
  summary: string;
  criteria: Array<{ criterion: string; points: number; guidance: string }>;
};

export type StoredFreeResponseQuestion = {
  type: "free_response";
  id: string;
  blockId: string;
  prompt: string;
  rubric: Rubric;
};

export type StoredQuestion = StoredFillQuestion | StoredFreeResponseQuestion;

export type PublicFillQuestion = Omit<StoredFillQuestion, "blanks"> & {
  blankIds: string[];
};

export type PublicFreeResponseQuestion = Omit<StoredFreeResponseQuestion, "rubric">;
export type PublicQuestion = PublicFillQuestion | PublicFreeResponseQuestion;

export type AttemptView = {
  attemptId: string;
  questionSetId: string;
  paperName: string;
  modelId: string;
  currentIndex: number;
  totalQuestions: number;
  question: PublicQuestion;
};

export const answerSubmissionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fill_blank"),
    selections: z.record(z.string(), z.string().nullable()),
  }),
  z.object({
    type: z.literal("free_response"),
    response: z.string().trim().min(1).max(50_000),
  }),
]);
export type AnswerSubmission = z.infer<typeof answerSubmissionSchema>;

export type FillReview = {
  type: "fill_blank";
  questionId: string;
  segments: QuestionSegment[];
  score: number;
  durationMs: number;
  blanks: Array<{
    blankId: string;
    selectedAnswer: string | null;
    correctAnswer: string;
    correct: boolean;
  }>;
};

export type FreeResponseReview = {
  type: "free_response";
  questionId: string;
  prompt: string;
  response: string;
  rubric: Rubric;
  score: number;
  feedback: string;
  durationMs: number;
};

export type AssessmentResult = {
  attemptId: string;
  questionSetId: string;
  paperName: string;
  overallScore: number;
  questions: Array<FillReview | FreeResponseReview>;
};

export function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function parseSegments(prompt: string, blankIds: Set<string>): QuestionSegment[] {
  const segments: QuestionSegment[] = [];
  const pattern = /\{\{([^{}]+)\}\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(prompt)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "text", value: prompt.slice(cursor, match.index) });
    }
    const blankId = match[1].trim();
    if (!blankIds.has(blankId)) {
      throw new Error(`Question references unknown blank "${blankId}".`);
    }
    segments.push({ type: "blank", blankId });
    cursor = match.index + match[0].length;
  }
  if (cursor < prompt.length) segments.push({ type: "text", value: prompt.slice(cursor) });

  for (const blankId of blankIds) {
    const occurrences = segments.filter(
      (segment) => segment.type === "blank" && segment.blankId === blankId,
    ).length;
    if (occurrences !== 1) {
      throw new Error(`Blank "${blankId}" must appear exactly once in its prompt.`);
    }
  }
  return segments;
}

export function prepareFillQuestions(
  generated: GeneratedFillSet,
  blockId: string,
): StoredFillQuestion[] {
  return generated.questions.map((question) => {
    const ids = question.blanks.map((blank) => blank.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("A generated question contains duplicate blank IDs.");
    }
    const choices: QuizChoice[] = [];
    const blanks = question.blanks.map((blank) => {
      const answerChoice = { id: globalThis.crypto.randomUUID(), label: blank.answer.trim() };
      choices.push(answerChoice);
      for (const distractor of blank.distractors) {
        choices.push({ id: globalThis.crypto.randomUUID(), label: distractor.trim() });
      }
      return {
        id: blank.id,
        answer: blank.answer.trim(),
        correctChoiceId: answerChoice.id,
      };
    });
    return {
      type: "fill_blank" as const,
      id: globalThis.crypto.randomUUID(),
      blockId,
      segments: parseSegments(question.prompt, new Set(ids)),
      choices: shuffled(choices),
      blanks,
    };
  });
}

export function prepareFreeResponseQuestions(
  generated: GeneratedFreeResponseSet,
  blockId: string,
): StoredFreeResponseQuestion[] {
  return generated.questions.map((question) => ({
    type: "free_response",
    id: globalThis.crypto.randomUUID(),
    blockId,
    prompt: question.prompt.trim(),
    rubric: question.rubric,
  }));
}

export function toPublicQuestion(question: StoredQuestion): PublicQuestion {
  if (question.type === "free_response") {
    const { rubric: _rubric, ...publicQuestion } = question;
    return publicQuestion;
  }
  const { blanks, ...publicQuestion } = question;
  return { ...publicQuestion, blankIds: blanks.map((blank) => blank.id) };
}
