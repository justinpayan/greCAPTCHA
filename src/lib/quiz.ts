import { z } from "zod";

export const pdfEngines = ["cloudflare-ai", "mistral-ocr", "native"] as const;
export const pdfEngineSchema = z.enum(pdfEngines);
export type PdfEngine = z.infer<typeof pdfEngineSchema>;

const generatedBlankSchema = z.object({
  id: z.string().min(1),
  answer: z.string().min(1),
  distractors: z.array(z.string().min(1)),
});

export const generatedQuizSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string().min(1),
      blanks: z.array(generatedBlankSchema).min(1),
    }),
  ),
});

export type GeneratedQuiz = z.infer<typeof generatedQuizSchema>;

export type QuizChoice = {
  id: string;
  label: string;
};

export type QuestionSegment =
  | { type: "text"; value: string }
  | { type: "blank"; blankId: string };

export type StoredBlank = {
  id: string;
  answer: string;
  correctChoiceId: string;
};

export type StoredQuestion = {
  id: string;
  segments: QuestionSegment[];
  choices: QuizChoice[];
  blanks: StoredBlank[];
};

export type PublicQuestion = Omit<StoredQuestion, "blanks"> & {
  blankIds: string[];
};

export type PublicQuiz = {
  id: string;
  paperName: string;
  modelId: string;
  pdfEngine: PdfEngine;
  questions: PublicQuestion[];
};

export const submissionSchema = z.object({
  answers: z.record(z.string(), z.string().nullable()),
});

function shuffled<T>(values: T[]): T[] {
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

  if (cursor < prompt.length) {
    segments.push({ type: "text", value: prompt.slice(cursor) });
  }

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

export function prepareQuestions(generated: GeneratedQuiz): StoredQuestion[] {
  return generated.questions.map((question, questionIndex) => {
    const ids = question.blanks.map((blank) => blank.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Question ${questionIndex + 1} contains duplicate blank IDs.`);
    }

    const choices: QuizChoice[] = [];
    const blanks: StoredBlank[] = question.blanks.map((blank, blankIndex) => {
      const answerChoice: QuizChoice = {
        id: globalThis.crypto.randomUUID(),
        label: blank.answer.trim(),
      };
      choices.push(answerChoice);
      blank.distractors.forEach((distractor, distractorIndex) => {
        choices.push({
          id: globalThis.crypto.randomUUID(),
          label: distractor.trim(),
        });
      });
      return {
        id: blank.id,
        answer: blank.answer.trim(),
        correctChoiceId: answerChoice.id,
      };
    });

    return {
      id: `question-${questionIndex + 1}`,
      segments: parseSegments(question.prompt, new Set(ids)),
      choices: shuffled(choices),
      blanks,
    };
  });
}

export function toPublicQuiz(
  id: string,
  paperName: string,
  modelId: string,
  pdfEngine: PdfEngine,
  questions: StoredQuestion[],
): PublicQuiz {
  return {
    id,
    paperName,
    modelId,
    pdfEngine,
    questions: questions.map(({ blanks, ...question }) => ({
      ...question,
      blankIds: blanks.map((blank) => blank.id),
    })),
  };
}
