import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultStudyBlocks } from "@/lib/default-study-template";
import { generateQuestionBlock, gradeFreeResponseBlock } from "@/lib/openrouter";
import {
  activeFixedRubric,
  fixedRubricProblems,
  fixedRubricSchema,
  generationConfigSchema,
  prepareFixedRubricQuestions,
  questionBlockSchema,
  type FixedRubric,
  type QuestionBlockConfig,
  type StoredFreeResponseQuestion,
} from "@/lib/quiz";

const rubric: FixedRubric = {
  summary: "Name the condition (30). Explain the mechanism (70).",
  levels: [
    { label: "Full", percent: 100 },
    { label: "Half", percent: 50 },
    { label: "None", percent: 0 },
  ],
  criteria: [
    { criterion: "Condition", description: "", points: 30, descriptions: ["Specific.", "Generic.", "Missing."] },
    {
      criterion: "Mechanism",
      description: "How it interacts with the work.",
      points: 70,
      descriptions: ["Causal path.", "Generic path.", "No path."],
    },
  ],
  gradingNote: "A stated limitation scores 0.",
};

const block = questionBlockSchema.parse({
  id: "free",
  type: "free_response",
  name: "Counterfactual",
  count: 1,
  candidatePoolSize: 1,
  prompt: "Ask about a condition this work was not built for.",
  rubricPrompt: "Write criteria with three levels.",
  fixedRubric: rubric,
}) as QuestionBlockConfig;

const generatedQuestion = {
  prompt: "Under which condition would the method degrade?",
  description: "Probes the method's limits.",
  page: 4,
  criterionNotes: ["Any condition tied to the sampler.", "Must pass through the sampler."],
  sampleAnswers: { partial: "Small data.", full: "Small data starves the sampler, so…" },
};

/** Stubs the provider with one reply and records the prompt it was sent. */
function stubProvider(reply: unknown) {
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      response_format: { json_schema: { name: string } };
      messages: Array<{ content: Array<{ text?: string }> }>;
    };
    sent.push(body.response_format.json_schema.name);
    sent.push(body.messages[0].content.find((part) => part.text)?.text ?? "");
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fixed rubrics", () => {
  it("lists what an unfinished rubric still needs, and blocks generation until it is done", () => {
    expect(fixedRubricProblems(rubric)).toEqual([]);
    const unfinished: FixedRubric = {
      ...rubric,
      summary: " ",
      levels: [...rubric.levels, { label: "", percent: 50 }],
      criteria: [{ ...rubric.criteria[0], points: 90 }],
    };
    expect(fixedRubricProblems(unfinished)).toEqual([
      "Write the summary shown to the participant.",
      "Name every level.",
      "Give every level a different share of the points.",
      "The criteria must total 100 points; they total 90.",
      "Describe every level of every criterion.",
    ]);
    // Still a valid card, so it autosaves; only generation refuses it.
    const card = { ...block, fixedRubric: unfinished };
    expect(questionBlockSchema.safeParse(card).success).toBe(true);
    expect(generationConfigSchema.safeParse([card]).success).toBe(false);
    expect(generationConfigSchema.safeParse([block]).success).toBe(true);
  });

  it("sets a fixed rubric aside for model-written rubrics and keeps it to switch back to", async () => {
    const setAside = questionBlockSchema.parse({
      ...block,
      fixedRubric: { ...rubric, summary: "" },
      modelWrittenRubric: true,
    });
    expect(activeFixedRubric(setAside)).toBeUndefined();
    // Set aside, an unfinished rubric no longer blocks generation, and is kept as it was.
    expect(generationConfigSchema.safeParse([setAside]).success).toBe(true);
    expect(setAside.type === "free_response" && setAside.fixedRubric?.summary).toBe("");
    const sent = stubProvider({
      questions: [{
        prompt: "Q?",
        description: "D.",
        page: 1,
        rubric: { summary: "S.", criteria: [{ criterion: "C", points: 100, guidance: "G." }] },
      }],
    });
    const result = await generateQuestionBlock({
      apiKey: "sk-or-test",
      file: new File([new Uint8Array([37, 80, 68, 70])], "paper.pdf"),
      contributions: "",
      block: setAside,
      previousQuestions: [],
      modelId: "test/model",
      pdfEngine: "native",
    });
    expect(sent[0]).toBe("research_captcha_free_response_questions");
    expect(sent[1]).toContain("Rubric generation instructions:\nWrite criteria with three levels.");
    expect(result.type).toBe("free_response");
    expect(activeFixedRubric({ ...setAside, modelWrittenRubric: false } as QuestionBlockConfig)).toEqual(
      setAside.type === "free_response" ? setAside.fixedRubric : undefined,
    );
  });

  it("reads a rubric saved with Full, Half, and None fields as three levels", () => {
    const legacy = {
      summary: "S",
      criteria: [{ criterion: "C", points: 100, full: "F.", half: "H.", none: "N." }],
    };
    expect(fixedRubricSchema.parse(legacy)).toEqual({
      summary: "S",
      levels: [
        { label: "Full", percent: 100 },
        { label: "Half", percent: 50 },
        { label: "None", percent: 0 },
      ],
      criteria: [{ criterion: "C", description: "", points: 100, descriptions: ["F.", "H.", "N."] }],
      gradingNote: "",
    });
  });

  it("gives every default free-response card a fixed rubric of 100 points", () => {
    const freeResponse = createDefaultStudyBlocks().filter((one) => one.type === "free_response");
    expect(freeResponse.length).toBeGreaterThan(0);
    for (const one of freeResponse) {
      if (one.type !== "free_response") continue;
      expect(fixedRubricProblems(fixedRubricSchema.parse(one.fixedRubric))).toEqual([]);
    }
  });

  it("asks the generator for notes and sample answers, not criteria", async () => {
    const sent = stubProvider({ questions: [generatedQuestion] });
    const result = await generateQuestionBlock({
      apiKey: "sk-or-test",
      file: new File([new Uint8Array([37, 80, 68, 70])], "paper.pdf", { type: "application/pdf" }),
      contributions: "",
      block,
      previousQuestions: [],
      modelId: "test/model",
      pdfEngine: "native",
    });
    expect(sent[0]).toBe("research_captcha_fixed_rubric_questions");
    expect(sent[1]).toContain(JSON.stringify(fixedRubricSchema.parse(rubric)));
    expect(sent[1]).toContain("exactly 2 notes, one per fixed criterion");
    expect(result.type).toBe("fixed_rubric");
  });

  it("refuses a question whose notes do not match the criteria", async () => {
    stubProvider({ questions: [{ ...generatedQuestion, criterionNotes: ["Only one."] }] });
    await expect(
      generateQuestionBlock({
        apiKey: "sk-or-test",
        file: new File([new Uint8Array([37, 80, 68, 70])], "paper.pdf"),
        contributions: "",
        block,
        previousQuestions: [],
        modelId: "test/model",
        pdfEngine: "native",
      }),
    ).rejects.toThrow(/1 rubric notes instead of 2/);
  });

  it("stores the fixed criteria with each question's notes, and shows the summary in the question", () => {
    const [question] = prepareFixedRubricQuestions({ questions: [generatedQuestion] }, block, rubric);
    expect(question.prompt).toBe(
      "Under which condition would the method degrade?\n\nHow your answer is graded: Name the condition (30). Explain the mechanism (70).",
    );
    expect(question.rubric).toMatchObject({
      summary: rubric.summary,
      fixed: true,
      gradingNote: "A stated limitation scores 0.",
      sampleAnswers: generatedQuestion.sampleAnswers,
    });
    expect(question.rubric.criteria.map((criterion) => criterion.points)).toEqual([30, 70]);
    expect(question.rubric.criteria[1].allowedPoints).toEqual([0, 35, 70]);
    expect(question.rubric.criteria[1].guidance).toBe(
      "How it interacts with the work.\nFull (70 points): Causal path.\nHalf (35 points): Generic path.\nNone (0 points): No path.\nFor this question: Must pass through the sampler.",
    );
  });

  it("holds the grader to the None, Half, and Full levels", async () => {
    const [question] = prepareFixedRubricQuestions({ questions: [generatedQuestion] }, block, rubric);
    const sent = stubProvider({
      grades: [{
        questionId: question.id,
        feedback: "Partly.",
        criteria: [
          // Between Half (15) and Full (30), nearer Half.
          { criterionIndex: 0, pointsAwarded: 22, justification: "Generic.", evidence: [] },
          // Exactly between Half (35) and Full (70): the lower level.
          { criterionIndex: 1, pointsAwarded: 52.5, justification: "Partial.", evidence: [] },
        ],
      }],
    });
    const graded = await gradeFreeResponseBlock({
      apiKey: "sk-or-test",
      modelId: "test/model",
      questions: [question as StoredFreeResponseQuestion],
      answers: { [question.id]: "Small data." },
    });
    expect(sent[1]).toContain('"allowedPoints":[0,15,30]');
    expect(sent[1]).toContain('"gradingNote":"A stated limitation scores 0."');
    expect(graded.grades[0].criteria.map((entry) => entry.pointsAwarded)).toEqual([15, 35]);
  });

  it("holds the grader to custom levels", async () => {
    const fourLevels: FixedRubric = {
      ...rubric,
      levels: [
        { label: "Excellent", percent: 100 },
        { label: "Good", percent: 75 },
        { label: "Weak", percent: 25 },
        { label: "Missing", percent: 0 },
      ],
      criteria: rubric.criteria.map((criterion) => ({
        ...criterion,
        descriptions: ["A.", "B.", "C.", "D."],
      })),
    };
    const [question] = prepareFixedRubricQuestions(
      { questions: [generatedQuestion] },
      block,
      fourLevels,
    );
    expect(question.rubric.criteria[0].allowedPoints).toEqual([0, 7.5, 22.5, 30]);
    expect(question.rubric.criteria[0].guidance).toContain("Good (22.5 points): B.");
    stubProvider({
      grades: [{
        questionId: question.id,
        feedback: "Mixed.",
        criteria: [
          { criterionIndex: 0, pointsAwarded: 20, justification: "Good.", evidence: [] },
          { criterionIndex: 1, pointsAwarded: 10, justification: "Weak.", evidence: [] },
        ],
      }],
    });
    const graded = await gradeFreeResponseBlock({
      apiKey: "sk-or-test",
      modelId: "test/model",
      questions: [question],
      answers: { [question.id]: "Small data." },
    });
    // 20 is nearest Good (22.5); 10 is nearest Weak (17.5) on a 70-point criterion.
    expect(graded.grades[0].criteria.map((entry) => entry.pointsAwarded)).toEqual([22.5, 17.5]);
  });
});
