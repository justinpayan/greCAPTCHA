import { File } from "node:buffer";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "rc_session" && sessionState.token
        ? { value: sessionState.token }
        : undefined,
  }),
}));

import { db } from "@/db";
import { attempts, jobs, sessions, users } from "@/db/schema";
import {
  accountForSession,
  authenticateAccount,
  createAccountSession,
  deleteAccountSession,
  getUserOpenRouterKey,
  registerAccount,
  updateUserOpenRouterKey,
} from "@/lib/accounts";
import {
  createSharedAttempt,
  getAttemptState,
  loadAttemptContext,
} from "@/lib/attempts";
import { requireOpenAttempt } from "@/lib/attempt-access";
import { getQuestionSetOverview } from "@/lib/catalog";
import {
  enqueueGenerationJob,
  enqueueGradingJob,
  getAttemptGradingJob,
  getOwnedJob,
} from "@/lib/jobs";
import { setOpenRouterTransportForTests } from "@/lib/openrouter";
import type { QuestionBlockConfig } from "@/lib/quiz";
import { POST as submitAnswer } from "@/app/api/attempts/[id]/answers/route";

let activeProviderCalls = 0;
let maxProviderCalls = 0;

setOpenRouterTransportForTests(async (input, init) => {
  const url = String(input);
  if (url.endsWith("/auth/key")) return Response.json({ data: { label: "test" } });
  if (url.endsWith("/models")) {
    return Response.json({
      data: [
        {
          id: "test/model",
          name: "Deterministic test model",
          architecture: { input_modalities: ["text", "file"], output_modalities: ["text"] },
        },
      ],
    });
  }
  if (!url.endsWith("/chat/completions")) throw new Error(`Unexpected URL: ${url}`);
  activeProviderCalls += 1;
  maxProviderCalls = Math.max(maxProviderCalls, activeProviderCalls);
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      response_format?: { json_schema?: { name?: string } };
      messages?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const schema = body.response_format?.json_schema?.name;
    let content: unknown;
    if (schema === "research_captcha_multiple_choice_questions") {
      content = {
        questions: [{
          prompt: "Which result is reported?",
          description: "Checks the main reported result.",
          answer: "Result A",
          distractors: ["Result B", "Result C", "Result D"],
          rationale: "The paper reports Result A.",
        }],
      };
    } else if (schema === "research_captcha_free_response_questions") {
      content = {
        questions: [{
          prompt: "Explain the main contribution.",
          description: "Checks understanding of the contribution.",
          rubric: {
            summary: "Names the contribution.",
            criteria: [{ criterion: "Correct contribution", points: 100, guidance: "Accept equivalents." }],
          },
        }],
      };
    } else if (schema === "research_captcha_fill_questions") {
      content = {
        questions: [{
          prompt: "The method uses {{method}}.",
          description: "Checks the method.",
          blanks: [{ id: "method", answer: "Method A", distractors: ["Method B", "Method C"] }],
        }],
      };
    } else if (schema === "research_captcha_free_response_grades") {
      const prompt = body.messages?.[0]?.content?.find((part) => part.text)?.text ?? "";
      const marker = "Questions, rubrics, and responses:\n";
      const items = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as Array<{
        questionId: string;
      }>;
      content = {
        grades: items.map((item) => ({
          questionId: item.questionId,
          score: 100,
          feedback: "Correct.",
        })),
      };
    } else {
      throw new Error(`Unexpected response schema: ${schema}`);
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  } finally {
    activeProviderCalls -= 1;
  }
});

async function waitForJob(jobId: string, ownerUserId: string) {
  for (let index = 0; index < 200; index += 1) {
    const job = await getOwnedJob(jobId, ownerUserId);
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error ?? "Job failed.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for job.");
}

const blocks: QuestionBlockConfig[] = [
  {
    id: "mc",
    type: "multiple_choice",
    name: "Facts",
    count: 1,
    optionsPerQuestion: 4,
    timeLimitSeconds: null,
    warmup: false,
    prompt: "Ask one factual question.",
  },
  {
    id: "free",
    type: "free_response",
    name: "Explanation",
    count: 1,
    timeLimitSeconds: null,
    warmup: false,
    prompt: "Ask one explanatory question.",
  },
];

async function enqueueSet(userId: string, suffix: string) {
  return enqueueGenerationJob(
    userId,
    new File([Buffer.from("%PDF-1.7 mocked")], `${suffix}.pdf`, {
      type: "application/pdf",
    }),
    {
      setName: `Set ${suffix}`,
      contributions: "All sections",
      modelId: "test/model",
      pdfEngine: "native",
      randomize: false,
      countdownHidden: false,
      overallTimeLimitSeconds: null,
      blocks,
    },
  );
}

describe("public demo account-to-grade flow", () => {
  it("encrypts credentials and keeps sessions separate", async () => {
    const alice = await registerAccount({
      username: "Alice.Test",
      password: "long-password-alice",
      openrouterApiKey: "sk-or-alice-secret",
    });
    const bob = await registerAccount({
      username: "Bob.Test",
      password: "long-password-bob",
      openrouterApiKey: "sk-or-bob-secret",
    });
    const [aliceToken, bobToken] = await Promise.all([
      createAccountSession(alice.id),
      createAccountSession(bob.id),
    ]);
    expect(aliceToken).not.toBe(bobToken);
    expect((await accountForSession(aliceToken))?.id).toBe(alice.id);
    expect((await accountForSession(bobToken))?.id).toBe(bob.id);
    expect((await authenticateAccount("ALICE.TEST", "long-password-alice"))?.id).toBe(alice.id);
    expect(await authenticateAccount("alice.test", "wrong-password")).toBeNull();

    const storedAlice = await db.select().from(users).where(eq(users.id, alice.id)).get();
    const storedSessions = await db.select().from(sessions);
    expect(JSON.stringify(storedAlice)).not.toContain("long-password-alice");
    expect(JSON.stringify(storedAlice)).not.toContain("sk-or-alice-secret");
    expect(JSON.stringify(storedSessions)).not.toContain(aliceToken);
    await deleteAccountSession(bobToken);
    expect(await accountForSession(bobToken)).toBeNull();

    await updateUserOpenRouterKey(alice.id, "sk-or-rotated-secret");
    expect(await getUserOpenRouterKey(alice.id)).toBe("sk-or-rotated-secret");
  });

  it("generates, takes, and grades a mixed assessment without network access", async () => {
    const alice = await db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get();
    if (!alice) throw new Error("Alice fixture missing.");
    const queued = await enqueueSet(alice.id, "complete-flow");
    const completed = await waitForJob(queued.jobId, alice.id);
    const generatedAttemptId = String(
      (completed.result as { attemptId?: string })?.attemptId ?? "",
    );
    expect(generatedAttemptId).toBeTruthy();
    const generated = await loadAttemptContext(generatedAttemptId);
    const shared = await createSharedAttempt(generated.set.id, alice.id);
    const attemptId = shared.attemptId;
    const bob = await db
      .select()
      .from(users)
      .where(eq(users.usernameNormalized, "bob.test"))
      .get();
    if (!bob) throw new Error("Bob fixture missing.");
    sessionState.token = await createAccountSession(bob.id);
    await requireOpenAttempt(attemptId, { claim: true });

    await getAttemptState(attemptId);
    let context = await loadAttemptContext(attemptId);
    if (context.currentQuestion.type !== "multiple_choice") throw new Error("Expected MC first.");
    let response = await submitAnswer(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "multiple_choice",
          optionId: context.currentQuestion.correctOptionId,
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(200);

    context = await loadAttemptContext(attemptId);
    if (context.currentQuestion.type !== "free_response") throw new Error("Expected free response.");
    response = await submitAnswer(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "free_response", response: "The main contribution." }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(202);
    const gradingRequest = await response.json() as { jobId: string };
    await waitForJob(gradingRequest.jobId, alice.id);
    const grading = await getAttemptGradingJob(attemptId);
    expect(grading.status).toBe("completed");
    expect((grading.result as { overallScore: number }).overallScore).toBe(100);
    const claimed = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
    expect(claimed?.takerUserId).toBe(bob.id);
    expect(claimed?.takerUsername).toBe(bob.username);
    sessionState.token = "";
  });

  it("isolates tenants and bounds concurrent provider work", async () => {
    const [alice, bob] = await Promise.all([
      db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get(),
      db.select().from(users).where(eq(users.usernameNormalized, "bob.test")).get(),
    ]);
    if (!alice || !bob) throw new Error("Account fixtures missing.");
    maxProviderCalls = 0;
    const [aliceJob, bobJob] = await Promise.all([
      enqueueSet(alice.id, "alice-concurrent"),
      enqueueSet(bob.id, "bob-concurrent"),
    ]);
    const [aliceResult, bobResult] = await Promise.all([
      waitForJob(aliceJob.jobId, alice.id),
      waitForJob(bobJob.jobId, bob.id),
    ]);
    expect(maxProviderCalls).toBeLessThanOrEqual(2);
    await expect(getOwnedJob(aliceJob.jobId, bob.id)).rejects.toThrow("Job not found");

    const aliceAttemptId = (aliceResult.result as { attemptId: string }).attemptId;
    const aliceAttempt = await db.select().from(attempts).where(eq(attempts.id, aliceAttemptId)).get();
    if (!aliceAttempt) throw new Error("Attempt missing.");
    await expect(getQuestionSetOverview(aliceAttempt.questionSetId, bob.id)).rejects.toThrow(
      "Question set not found",
    );

    const extra = await Promise.allSettled([
      enqueueSet(alice.id, "race-one"),
      enqueueSet(alice.id, "race-two"),
    ]);
    expect(extra.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accepted = extra.find((result) => result.status === "fulfilled");
    if (accepted?.status === "fulfilled") await waitForJob(accepted.value.jobId, alice.id);

    const duplicate = await Promise.all([
      enqueueGradingJob(aliceAttemptId),
      enqueueGradingJob(aliceAttemptId),
    ]);
    expect(duplicate[0].jobId).toBe(duplicate[1].jobId);
    expect((await db.select().from(jobs).where(and(
      eq(jobs.attemptId, aliceAttemptId),
      eq(jobs.type, "grading"),
    ))).length).toBe(1);
  });
});
