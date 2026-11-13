import { File } from "node:buffer";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "rc_session" && sessionState.token ? { value: sessionState.token } : undefined,
  }),
}));

import { db } from "@/db";
import { questionSets } from "@/db/schema";
import { createAccountSession, registerAccount } from "@/lib/accounts";
import { requireOpenAttempt } from "@/lib/attempt-access";
import {
  createQuestionSetShareLink,
  getAttemptState,
  getOrCreateTakerAttempt,
  loadAttemptContext,
} from "@/lib/attempts";
import { bundleFromZip, serializeBundle } from "@/lib/code-bundle";
import { submitAttempt } from "@/lib/attempt-submit";
import { enqueueGenerationJob, getAttemptGradingJob, getOwnedJob } from "@/lib/jobs";
import { saveOpenRouterCredential } from "@/lib/openrouter-credentials";
import { buildAnswerCsv } from "@/lib/export";
import { manuscriptPath } from "@/lib/manuscripts";
import { setOpenRouterTransportForTests } from "@/lib/openrouter";
import type { AssessmentResult, QuestionBlockConfig, StoredQuestion } from "@/lib/quiz";
import { GET as getCode } from "@/app/api/attempts/[id]/code/route";
import { GET as getPdf } from "@/app/api/attempts/[id]/pdf/route";
import { POST as submitAnswer } from "@/app/api/attempts/[id]/answers/route";
import { POST as navigateAttempt } from "@/app/api/attempts/[id]/navigate/route";
import fs from "node:fs";

const sentPrompts: string[] = [];
const sentCode: string[] = [];

setOpenRouterTransportForTests(async (input, init) => {
  const url = String(input);
  if (url.endsWith("/key")) {
    return Response.json({ data: { label: "test", limit: 10, limit_remaining: 10, expires_at: "2099-01-01T00:00:00Z" } });
  }
  if (url.endsWith("/models")) {
    return Response.json({
      data: [{
        id: "test/text-model",
        name: "Text-only test model",
        context_length: 200_000,
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      }],
    });
  }
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    response_format: { json_schema: { name: string } };
    messages: Array<{ content: Array<{ type: string; text?: string }> }>;
  };
  const [codePart, promptPart] = body.messages[0].content;
  sentCode.push(codePart.text ?? "");
  sentPrompts.push(promptPart.text ?? "");
  const schema = body.response_format.json_schema.name;
  const count = Number(/Generate exactly (\d+) candidate/.exec(promptPart.text ?? "")?.[1] ?? "1");
  let content: unknown;
  if (schema === "research_captcha_multiple_choice_questions") {
    content = {
      questions: Array.from({ length: count }, (_, index) => ({
        prompt: "What does `total([1, 2])` return?",
        description: `Traces total() candidate ${index + 1}.`,
        path: "src/cart.py",
        startLine: 4,
        endLine: 6,
        answer: "3",
        distractors: ["2"],
        rationale: "It sums the prices.",
      })),
    };
  } else if (schema === "research_captcha_free_response_questions") {
    content = {
      questions: Array.from({ length: count }, (_, index) => ({
        prompt: `Why does apply_discount clamp at zero? (${index + 1})`,
        description: "Probes the discount guard.",
        path: "src/cart.py",
        startLine: 1,
        endLine: 2,
        rubric: { summary: "Explains the guard.", criteria: [{ criterion: "Guard", points: 100, guidance: "Any valid reason." }] },
      })),
    };
  } else if (schema === "research_captcha_free_response_grades") {
    const marker = "Questions, rubrics, and responses:\n";
    const prompt = promptPart.text ?? "";
    const items = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as Array<{ questionId: string }>;
    content = {
      grades: items.map((item) => ({
        questionId: item.questionId,
        feedback: "Right.",
        criteria: [{ criterionIndex: 0, pointsAwarded: 100, justification: "Correct.", evidence: [] }],
      })),
    };
  } else {
    throw new Error(`Unexpected schema ${schema}`);
  }
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
});

const blocks: QuestionBlockConfig[] = [
  { id: "mc", type: "multiple_choice", name: "Execution tracing", count: 1, candidatePoolSize: 2, optionsPerQuestion: 2, warmup: false, prompt: "Trace." },
  { id: "fr", type: "free_response", name: "Rationale", count: 1, candidatePoolSize: 2, warmup: false, prompt: "Why.", rubricPrompt: "" },
];

async function waitForJob(jobId: string, ownerUserId: string) {
  for (let index = 0; index < 300; index += 1) {
    const job = await getOwnedJob(jobId, ownerUserId);
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error ?? "Job failed.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for job.");
}

describe("an assessment generated from a codebase", () => {
  it("generates from the code, serves it to the taker, and grades against it", async () => {
    const owner = await registerAccount({ username: "code-owner", password: "long password for code" });
    const taker = await registerAccount({ username: "code-taker", password: "long password for code" });
    const bundle = bundleFromZip(
      zipSync({
        "shop-main/src/cart.py": strToU8(
          "def apply_discount(price, pct):\n    return max(0, price - price * pct)\n\ndef total(prices):\n    s = sum(prices)\n    return s\n",
        ),
        "shop-main/.env": strToU8("STRIPE_KEY=secret"),
        "shop-main/node_modules/x/index.js": strToU8("x"),
      }),
      "shop-main.zip",
    );
    const queued = await enqueueGenerationJob(
      owner.id,
      new File([serializeBundle(bundle)], bundle.name, { type: "application/json" }),
      {
        materialKind: "code",
        setName: "Shop",
        apiKeyPayer: "creator",
        materialUploader: "creator",
        contributions: "I wrote src/cart.py.",
        modelId: "test/text-model",
        pdfEngine: "native",
        randomize: false,
        overallTimeLimitSeconds: null,
        blocks,
      },
      "sk-or-code-test",
    );
    const completed = await waitForJob(queued.jobId, owner.id);
    const setId = String((completed.result as { questionSetId: string }).questionSetId);

    // A text-only model is accepted: no PDF is involved.
    const set = await db.select().from(questionSets).where(eq(questionSets.id, setId)).get();
    expect(set?.materialKind).toBe("code");
    expect(set?.paperName).toBe("shop-main");
    expect(set?.paperTitle).toBeNull();
    expect(fs.existsSync(manuscriptPath(setId, "code"))).toBe(true);
    expect(fs.existsSync(manuscriptPath(setId))).toBe(false);
    const stored = JSON.parse(set!.questionsJson) as StoredQuestion[];
    expect(stored.map((question) => question.sourceLocation)).toEqual([
      { path: "src/cart.py", startLine: 4, endLine: 6 },
      { path: "src/cart.py", startLine: 1, endLine: 2 },
    ]);
    expect(sentCode[0]).toContain('<file path="src/cart.py" lines="6">');
    expect(sentCode[0]).not.toContain("STRIPE_KEY");
    expect(sentPrompts[0]).toContain("I wrote src/cart.py.");

    const shared = await createQuestionSetShareLink(setId, owner.id);
    const attempt = await getOrCreateTakerAttempt(shared.participantPath.split("/").pop()!, taker);
    sessionState.token = await createAccountSession(taker.id);
    await requireOpenAttempt(attempt.attemptId, { claim: true });

    const view = await getAttemptState(attempt.attemptId);
    expect(view.attempt?.materialKind).toBe("code");
    expect(view.attempt?.question.sourceLocation).toEqual({ path: "src/cart.py", startLine: 4, endLine: 6 });

    const params = { params: Promise.resolve({ id: attempt.attemptId }) };
    const codeResponse = await getCode(new Request("http://localhost/code"), params);
    expect(codeResponse.status).toBe(200);
    const code = (await codeResponse.json()) as { name: string; files: Array<{ path: string }> };
    expect(code.name).toBe("shop-main");
    expect(code.files.map((file) => file.path)).toEqual(["src/cart.py"]);
    // The PDF route has nothing to serve for a codebase.
    expect((await getPdf(new Request("http://localhost/pdf"), params)).status).toBe(404);

    const post = (body: unknown) =>
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    let context = await loadAttemptContext(attempt.attemptId);
    if (context.currentQuestion.type !== "multiple_choice") throw new Error("Expected multiple choice.");
    expect((await submitAnswer(post({
      questionId: context.currentQuestion.id,
      answer: { type: "multiple_choice", optionId: context.currentQuestion.correctOptionId },
    }), params)).status).toBe(200);
    expect((await navigateAttempt(post({ index: 1 }), params)).status).toBe(200);
    context = await loadAttemptContext(attempt.attemptId);
    expect((await submitAnswer(post({
      questionId: context.currentQuestion.id,
      answer: { type: "free_response", response: "So a discount over 100% cannot make the price negative." },
    }), params)).status).toBe(200);

    await saveOpenRouterCredential(owner.id, "sk-or-code-owner");
    const submitted = (await submitAttempt(attempt.attemptId, "manual")) as { grading?: { jobId: string } };
    await waitForJob(submitted.grading!.jobId, owner.id);
    const result = (await getAttemptGradingJob(attempt.attemptId)).result as AssessmentResult;
    expect(result.materialKind).toBe("code");
    expect(result.overallScore).toBe(100);

    // The export says which kind each set is, and where in the code each question draws on.
    const csv = await buildAnswerCsv(owner.id, [setId]);
    const [header, ...rows] = csv.trim().split("\r\n");
    expect(header.endsWith(",material_kind,source_location")).toBe(true);
    expect(rows.map((row) => row.split(",").slice(-2).join(","))).toEqual([
      "code,src/cart.py:4-6",
      "code,src/cart.py:1-2",
    ]);
    const gradingPrompt = sentPrompts[sentPrompts.length - 1];
    expect(gradingPrompt).toContain("using the codebase above");
    expect(sentCode[sentCode.length - 1]).toContain("def apply_discount");
  });

  it("refuses a codebase that does not fit the model before spending anything on it", async () => {
    const owner = await registerAccount({ username: "code-owner-2", password: "long password for code" });
    const big = bundleFromZip(
      zipSync({ "data.py": strToU8(`DATA = """${"x".repeat(700_000)}"""\n`) }),
      "big.zip",
    );
    const before = sentPrompts.length;
    const queued = await enqueueGenerationJob(
      owner.id,
      new File([serializeBundle(big)], big.name, { type: "application/json" }),
      {
        materialKind: "code",
        setName: "Big",
        apiKeyPayer: "creator",
        materialUploader: "creator",
        contributions: "",
        modelId: "test/text-model",
        pdfEngine: "native",
        randomize: false,
        overallTimeLimitSeconds: null,
        blocks,
      },
      "sk-or-code-test",
    );
    await expect(waitForJob(queued.jobId, owner.id)).rejects.toThrow(/tokens after filtering/);
    expect(sentPrompts.length).toBe(before);
  });
});
