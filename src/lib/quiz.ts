import { z } from "zod";

export const pdfEngines = ["cloudflare-ai", "mistral-ocr", "native"] as const;
export const pdfEngineSchema = z.enum(pdfEngines);
export type PdfEngine = z.infer<typeof pdfEngineSchema>;

export const DEFAULT_FILL_PROMPT = `Generate fill-in-the-blank questions that verify how well a claimed author understands the submitted manuscript.

Ask only questions the author should reasonably answer given their stated contributions. Questions should be difficult for someone who does not understand the work but straightforward for someone who does. Require conceptual understanding rather than calculations. Do not make answers discoverable through obvious keyword searches, context clues, common sense, grammar, or whether a word appears in the paper. Every blank must have one objectively correct word or short phrase. Multiple blanks are allowed. Use "a/an" where needed to avoid telegraphing an answer. Distractors must fit grammatically and be plausible but objectively wrong.`;

export const DEFAULT_FREE_RESPONSE_PROMPT = `Generate free-response questions that verify the author's conceptual understanding of the manuscript in areas connected to their stated contributions.

Questions should be difficult for someone who did not contribute to or deeply understand the work, but answerable without calculations by a genuine contributor. Avoid requests that can be answered by copying a sentence from the paper. For each question, construct an objective 100-point rubric with explicit criteria, point allocations, and guidance about what evidence earns full, partial, or no credit. Allow substantively equivalent wording and multiple valid explanations where appropriate. The rubric must support consistent grading without requiring exact phrasing.`;

export const DEFAULT_MULTIPLE_CHOICE_PROMPT = `Generate multiple-choice questions that test whether a claimed author can recognise subtly incorrect statements about their own manuscript.

Each question presents a specific claim about the paper's methods, results, or design decisions. Exactly one option must accurately state what the paper reports; every other option must be a plausible but objectively false variant of it. Perturb a value, a referent, or an attribution, never a qualitative direction, which is too easy to spot. Never perturb something the paper restates elsewhere, and never let an option be checked by matching a single keyword. Options must be mutually exclusive, similar in length and specificity, and grammatically consistent with the question. Someone who understands the work should recognise the correct option immediately; someone who does not should have to verify every option against the paper.`;

const blockBase = {
  id: z.string().min(1).max(100),
  // Researcher-facing label for the card, e.g. "F1 planted error". Never shown to the
  // participant; snapshotted onto each answer row so exports can group by family.
  name: z.string().max(80).default(""),
  count: z.number().int().min(1).max(30),
  prompt: z.string().min(20).max(20_000),
  // Soft timer: displayed to the participant and used to flag overruns, never enforced.
  // null means the questions from this card are untimed.
  timeLimitSeconds: z.number().int().min(5).max(3_600).nullable().default(null),
  // Warm-up items are graded and reviewed but excluded from the overall score, and they
  // always lead the attempt in card order even when the rest is randomized.
  warmup: z.boolean().default(false),
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
  z.object({
    ...blockBase,
    type: z.literal("multiple_choice"),
    optionsPerQuestion: z.number().int().min(2).max(10),
  }),
]);

export const generationConfigSchema = z.array(questionBlockSchema).min(1).max(20);
export type QuestionBlockConfig = z.infer<typeof questionBlockSchema>;

/**
 * Everything on the generation screen except the PDF and the contribution statement, so
 * one template runs across every participant's manuscript.
 *
 * Deliberately more permissive than `generationConfigSchema`: a draft is autosaved while
 * the screen is mid-edit, and an empty card list or an unchosen model must not make the
 * save fail. The stricter schema still gates generation itself.
 */
export const studyTemplateConfigSchema = z.object({
  modelId: z.string().max(200).default(""),
  pdfEngine: pdfEngineSchema.default("native"),
  blocks: z.array(questionBlockSchema).max(20).default([]),
  randomize: z.boolean().default(false),
  countdownHidden: z.boolean().default(false),
  /**
   * Budget for the whole set in seconds, or null for none. Enforced, unlike the per-question soft
   * limits: once it is spent no further question is served. Stored in seconds like every other
   * limit here, though the form collects whole minutes.
   */
  overallTimeLimitSeconds: z.number().int().min(30).max(21_600).nullable().default(null),
});
export type StudyTemplateConfig = z.infer<typeof studyTemplateConfigSchema>;

export type QuestionSetListEntry = {
  id: string;
  /** Empty when the set was never named; `label` is what to display. */
  name: string;
  label: string;
  paperName: string;
  modelId: string;
  questionCount: number;
  attemptCount: number;
  /** Experiments depending on this set. Non-zero makes the set undeletable. */
  experimentCount: number;
  createdAt: string;
};

/**
 * A saved set's contents, readable without creating an attempt.
 *
 * Researcher-facing, like `AttemptOutline`: it carries card names and generated descriptions, so
 * it must never reach a participant screen. Unlike the outline it has no answered state and no
 * participant link, because no attempt is involved.
 */
export type QuestionSetOverviewItem = {
  position: number;
  questionId: string;
  type: StoredQuestion["type"];
  blockName: string;
  description: string;
  timeLimitSeconds: number | null;
  warmup: boolean;
};

export type QuestionSetOverview = {
  id: string;
  /** Empty when the set was never named; `label` is what to display. */
  name: string;
  label: string;
  paperName: string;
  modelId: string;
  pdfEngine: string;
  overallTimeLimitSeconds: number | null;
  attemptCount: number;
  experimentCount: number;
  createdAt: string;
  items: QuestionSetOverviewItem[];
};

/**
 * Which paper an attempt belongs to inside its experiment (research plan §8.2). `foreign` is
 * the plan's term for it and stays the stored value; the interface calls it the unfamiliar
 * paper, via `CONDITION_LABELS`.
 */
export const attemptConditions = ["own", "foreign"] as const;
export type AttemptCondition = (typeof attemptConditions)[number];

/** Between-subjects split of the unfamiliar paper. */
export const foreignStrata = ["in_field", "out_of_field"] as const;
export type ForeignStratum = (typeof foreignStrata)[number];

export const FOREIGN_STRATUM_LABELS: Record<ForeignStratum, string> = {
  in_field: "In-field",
  out_of_field: "Out-of-field",
};

export const CONDITION_LABELS: Record<AttemptCondition, string> = {
  own: "Own paper",
  foreign: "Unfamiliar paper",
};

/** One attempt of an experiment, in the order the participant will meet it. */
export type ExperimentAttempt = {
  attemptId: string;
  condition: AttemptCondition;
  /** 1 or 2 — which block this attempt is, after counterbalancing. */
  blockPosition: number;
  questionSetId: string;
  setLabel: string;
  paperName: string;
  status: string;
  score: number | null;
  linkEnabled: boolean;
  answeredCount: number;
  totalQuestions: number;
};

export type ExperimentListEntry = {
  id: string;
  participantId: string;
  foreignStratum: ForeignStratum;
  /** True when the unfamiliar paper is block A. */
  foreignFirst: boolean;
  createdAt: string;
  /** Both attempts, already sorted into block order. */
  attempts: ExperimentAttempt[];
};

/**
 * Ordered block plan behind a single chained participant link.
 *
 * Carries attempt IDs and their positions and nothing else — no condition, no paper names, no
 * participant ID. Each attempt then gates itself through the ordinary participant endpoints, so
 * this hands out no access the two individual links would not.
 */
export type ExperimentSessionPlan = {
  experimentId: string;
  blocks: Array<{ attemptId: string; position: number }>;
};

/**
 * What the next experiment will be allocated, so the researcher can pick an unfamiliar paper
 * from the right stratum *before* creating the experiment. `null` means the cells are level and the
 * choice will be made at random on creation, so nothing is promised that cannot be kept.
 */
export type ExperimentAllocation = {
  nextForeignStratum: ForeignStratum | null;
  counts: {
    total: number;
    inField: number;
    outOfField: number;
    foreignFirst: number;
    ownFirst: number;
  };
};

export type AttemptListEntry = {
  id: string;
  questionSetId: string;
  setLabel: string;
  paperName: string;
  /** Set when the attempt is half of an experiment; both null for a standalone attempt. */
  participantId: string | null;
  condition: AttemptCondition | null;
  status: string;
  score: number | null;
  randomize: boolean;
  /** False while the participant link is closed, so a mailed link cannot be started early. */
  linkEnabled: boolean;
  answeredCount: number;
  totalQuestions: number;
  createdAt: string;
};

export type StudyTemplateSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

const generatedBlankSchema = z.object({
  id: z.string().min(1),
  answer: z.string().min(1),
  distractors: z.array(z.string().min(1)),
});

export const generatedFillSetSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string().min(1),
      description: z.string().min(1),
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
      description: z.string().min(1),
      rubric: z.object({
        summary: z.string().min(1),
        criteria: z.array(rubricCriterionSchema).min(1),
      }),
    }),
  ),
});

// The model supplies the correct answer plus distractors rather than an index into an
// option list, so a miscounted index can never mislabel the key.
export const generatedMultipleChoiceSetSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string().min(1),
      description: z.string().min(1),
      answer: z.string().min(1),
      distractors: z.array(z.string().min(1)).min(1),
      rationale: z.string().min(1),
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
export type GeneratedMultipleChoiceSet = z.infer<typeof generatedMultipleChoiceSetSchema>;
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
  // Optional because question sets generated before soft timers existed have no limit stored.
  timeLimitSeconds?: number | null;
  warmup?: boolean;
  blockName?: string;
  description?: string;
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
  timeLimitSeconds?: number | null;
  warmup?: boolean;
  blockName?: string;
  description?: string;
  prompt: string;
  rubric: Rubric;
};

export type StoredMultipleChoiceQuestion = {
  type: "multiple_choice";
  id: string;
  blockId: string;
  timeLimitSeconds?: number | null;
  warmup?: boolean;
  blockName?: string;
  description?: string;
  prompt: string;
  /** Already shuffled at generation, so every attempt on this set sees the same order. */
  options: QuizChoice[];
  correctOptionId: string;
  /** Withheld until the review screen. */
  rationale: string;
};

export type StoredQuestion =
  | StoredFillQuestion
  | StoredFreeResponseQuestion
  | StoredMultipleChoiceQuestion;

// `warmup` is stripped from every public shape. Telling the participant an item does not
// count would undermine its use as a per-participant latency baseline (§3.2 F6); the review
// screen labels warm-ups after scoring instead.
export type PublicFillQuestion = Omit<StoredFillQuestion, "blanks" | "warmup" | "blockName" | "description"> & {
  blankIds: string[];
};

export type PublicFreeResponseQuestion = Omit<
  StoredFreeResponseQuestion,
  "rubric" | "warmup" | "blockName" | "description"
>;
export type PublicMultipleChoiceQuestion = Omit<
  StoredMultipleChoiceQuestion,
  "correctOptionId" | "rationale" | "warmup" | "blockName" | "description"
>;
export type PublicQuestion =
  | PublicFillQuestion
  | PublicFreeResponseQuestion
  | PublicMultipleChoiceQuestion;

/**
 * What the landing page shown before a question set needs, and nothing more.
 *
 * Reading this does **not** serve a question, which is the whole point: the first question's
 * clock starts when the participant presses Start, not when the page loads. Deliberately free
 * of card names, item descriptions and warm-up flags — it is participant-facing.
 */
export type AttemptIntro = {
  attemptId: string;
  // No paper name. The landing page does not show one, and a filename can betray which of an
  // experiment's two papers is the participant's own, so it is not sent to their browser.
  totalQuestions: number;
  /** How many carry a soft limit, so the page can say whether the set is timed at all. */
  timedQuestionCount: number;
  /** Budget for the whole set in seconds, or null. Enforced once spent. */
  overallTimeLimitSeconds: number | null;
  /** True once a question has been served, meaning the clock is already running. */
  started: boolean;
  status: string;
  countdownHidden: boolean;
};

export type AttemptView = {
  attemptId: string;
  questionSetId: string;
  /**
   * What to title the assessment. The real filename for a standalone attempt, but "Paper 1" or
   * "Paper 2" for an experiment's attempts: a filename can betray which of the two papers is the
   * participant's own, so it is never sent to their browser.
   */
  paperName: string;
  // No model ID. The participant is not shown which model generated or grades their items, and
  // what is not displayed is not sent — `AttemptOutline` carries it for the researcher instead.
  currentIndex: number;
  totalQuestions: number;
  question: PublicQuestion;
  /** Fixed for the whole attempt: suppresses the on-screen timer without affecting recording. */
  countdownHidden: boolean;
  /** Server-measured time already spent on this question, so a refresh resumes the display. */
  elapsedMs: number;
  /** Budget for the whole set in seconds, or null when the set is unlimited. */
  overallTimeLimitSeconds: number | null;
  /**
   * Spent against that budget: every finished question's duration plus the live time on this one.
   * A sum rather than wall-clock, so a paused session or a closed laptop costs nothing.
   */
  overallElapsedMs: number;
  /** True once the server has stamped a first interaction, so a refresh does not re-ping. */
  firstInteractionRecorded: boolean;
};

/**
 * Researcher-facing plan of an attempt. Carries card names and generated descriptions,
 * so it must only ever back the summary screen, never the test-taking screens.
 */
export type AttemptOutlineItem = {
  position: number;
  questionId: string;
  type: StoredQuestion["type"];
  blockName: string;
  description: string;
  timeLimitSeconds: number | null;
  warmup: boolean;
  answered: boolean;
};

export type AttemptOutline = {
  attemptId: string;
  questionSetId: string;
  /** The set's name, falling back to the PDF filename when it was never named. */
  setLabel: string;
  paperName: string;
  modelId: string;
  status: string;
  /**
   * Whether the participant link currently opens. A researcher session bypasses it, so this
   * governs the mailed link rather than the Start button on this page.
   */
  linkEnabled: boolean;
  /** Present when this attempt is one block of an experiment, so the plan page can say which. */
  experiment: {
    participantId: string;
    condition: AttemptCondition;
    blockPosition: number;
    foreignStratum: ForeignStratum;
  } | null;
  totalQuestions: number;
  answeredCount: number;
  scoredQuestionCount: number;
  graded: boolean;
  /** Every question answered but no result stored yet, so grading can still be run. */
  gradable: boolean;
  /**
   * Origin to build the participant link from, from PUBLIC_BASE_URL. Empty falls back to
   * the browser's own origin — which would be wrong if the researcher is on localhost
   * while participants reach the app through a tunnel.
   */
  participantBaseUrl: string;
  items: AttemptOutlineItem[];
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
  z.object({
    type: z.literal("multiple_choice"),
    optionId: z.string().min(1),
  }),
  // Declining the question. Carries no answer, and is accepted for any question type, so it
  // is exempt from the check that a submission's type matches the question being served.
  z.object({ type: z.literal("skip") }),
]);
export type AnswerSubmission = z.infer<typeof answerSubmissionSchema>;

/** Per-item timing telemetry carried into the graded result and the review screen. */
export type QuestionTiming = {
  durationMs: number;
  /** Time from the question first being served to the first answer interaction. */
  firstInteractionMs: number | null;
  /** The soft limit in force when the question was served, or null if untimed. */
  timeLimitSeconds: number | null;
  /** Milliseconds spent beyond the soft limit; 0 within the limit, null if untimed. */
  overrunMs: number | null;
};

type ReviewBase = QuestionTiming & {
  /** Graded and shown, but excluded from the overall score. */
  warmup: boolean;
  /** Declined rather than answered. Scored 0, and labelled as skipped on the review. */
  skipped: boolean;
  /** Never answered because the overall budget ran out. Scored 0, and labelled separately. */
  timedOut: boolean;
};

export type FillReview = ReviewBase & {
  type: "fill_blank";
  questionId: string;
  segments: QuestionSegment[];
  score: number;
  blanks: Array<{
    blankId: string;
    selectedAnswer: string | null;
    correctAnswer: string;
    correct: boolean;
  }>;
};

export type FreeResponseReview = ReviewBase & {
  type: "free_response";
  questionId: string;
  prompt: string;
  response: string;
  rubric: Rubric;
  score: number;
  feedback: string;
};

export type MultipleChoiceReview = ReviewBase & {
  type: "multiple_choice";
  questionId: string;
  prompt: string;
  options: QuizChoice[];
  selectedOptionId: string | null;
  correctOptionId: string;
  correct: boolean;
  rationale: string;
  score: number;
};

export type QuestionReview = FillReview | FreeResponseReview | MultipleChoiceReview;

export type AssessmentResult = {
  attemptId: string;
  questionSetId: string;
  paperName: string;
  /** Equal-weight average across scored questions only; warm-ups are excluded. */
  overallScore: number;
  scoredQuestionCount: number;
  warmupQuestionCount: number;
  questions: QuestionReview[];
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
  block: QuestionBlockConfig,
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
      blockId: block.id,
      timeLimitSeconds: block.timeLimitSeconds,
      warmup: block.warmup,
      blockName: block.name,
      description: question.description.trim(),
      segments: parseSegments(question.prompt, new Set(ids)),
      choices: shuffled(choices),
      blanks,
    };
  });
}

export function prepareFreeResponseQuestions(
  generated: GeneratedFreeResponseSet,
  block: QuestionBlockConfig,
): StoredFreeResponseQuestion[] {
  return generated.questions.map((question) => ({
    type: "free_response",
    id: globalThis.crypto.randomUUID(),
    blockId: block.id,
    timeLimitSeconds: block.timeLimitSeconds,
    warmup: block.warmup,
    blockName: block.name,
    description: question.description.trim(),
    prompt: question.prompt.trim(),
    rubric: question.rubric,
  }));
}

/** Compares option text the same way fill-in-the-blank grading compares answers. */
function sameOptionText(a: string, b: string) {
  return (
    a.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") ===
    b.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
  );
}

export function prepareMultipleChoiceQuestions(
  generated: GeneratedMultipleChoiceSet,
  block: QuestionBlockConfig,
): StoredMultipleChoiceQuestion[] {
  return generated.questions.map((question) => {
    const answer = question.answer.trim();
    const distractors = question.distractors.map((distractor) => distractor.trim());

    // A distractor equal to the key leaves the item with two correct options, so reject
    // the whole generation rather than storing an unanswerable question.
    if (distractors.some((distractor) => sameOptionText(distractor, answer))) {
      throw new Error("A generated question repeats its correct answer as a distractor.");
    }
    for (let index = 1; index < distractors.length; index += 1) {
      if (
        distractors
          .slice(0, index)
          .some((earlier) => sameOptionText(earlier, distractors[index]))
      ) {
        throw new Error("A generated question contains duplicate options.");
      }
    }

    const correctOption = { id: globalThis.crypto.randomUUID(), label: answer };
    const options = shuffled([
      correctOption,
      ...distractors.map((label) => ({ id: globalThis.crypto.randomUUID(), label })),
    ]);
    return {
      type: "multiple_choice" as const,
      id: globalThis.crypto.randomUUID(),
      blockId: block.id,
      timeLimitSeconds: block.timeLimitSeconds,
      warmup: block.warmup,
      blockName: block.name,
      description: question.description.trim(),
      prompt: question.prompt.trim(),
      options,
      correctOptionId: correctOption.id,
      rationale: question.rationale.trim(),
    };
  });
}

/** Normalizes the limit for question sets stored before soft timers existed. */
export function questionTimeLimit(question: StoredQuestion): number | null {
  return question.timeLimitSeconds ?? null;
}

/** Researcher-facing card label, blank for questions generated before names existed. */
export function questionBlockName(question: StoredQuestion): string {
  return question.blockName?.trim() ?? "";
}

/** Normalizes the flag for question sets stored before warm-ups existed. */
export function isWarmup(question: StoredQuestion): boolean {
  return question.warmup === true;
}

export function toPublicQuestion(question: StoredQuestion): PublicQuestion {
  const timeLimitSeconds = questionTimeLimit(question);
  if (question.type === "free_response") {
    const { rubric: _r, warmup: _w, blockName: _b, description: _d, ...publicQuestion } =
      question;
    return { ...publicQuestion, timeLimitSeconds };
  }
  if (question.type === "multiple_choice") {
    const {
      correctOptionId: _correctOptionId,
      rationale: _rationale,
      warmup: _warmup,
      blockName: _blockName,
      description: _description,
      ...publicQuestion
    } = question;
    return { ...publicQuestion, timeLimitSeconds };
  }
  const { blanks, warmup: _w, blockName: _b, description: _d, ...publicQuestion } =
    question;
  return {
    ...publicQuestion,
    timeLimitSeconds,
    blankIds: blanks.map((blank) => blank.id),
  };
}
