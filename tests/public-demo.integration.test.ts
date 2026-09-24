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
import {
  attempts,
  conferenceSubmissions,
  jobs,
  openRouterCredentials,
  questionSets,
  sessions,
  studyTemplates,
  users,
} from "@/db/schema";
import {
  accountForSession,
  authenticateAccount,
  createAccountSession,
  deleteAccountSession,
  registerAccount,
} from "@/lib/accounts";
import {
  createQuestionSetShareLink,
  getAttemptState,
  getAttemptOutline,
  getOrCreateTakerAttempt,
  loadAttemptContext,
} from "@/lib/attempts";
import { requireOpenAttempt } from "@/lib/attempt-access";
import {
  deleteAttempt,
  deleteQuestionSet,
  getQuestionSetOverview,
  listCreatedTests,
  listTakerAttempts,
} from "@/lib/catalog";
import { buildAnswerCsv } from "@/lib/export";
import {
  enqueueGenerationJob,
  enqueueGradingJob,
  getConferenceJob,
  getAttemptGradingJob,
  getOwnedJob,
} from "@/lib/jobs";
import { clearJobKeys, registerJobKey, requireJobKey } from "@/lib/openrouter-key-store";
import { credentialStatus, saveOpenRouterCredential } from "@/lib/openrouter-credentials";
import { setOpenRouterTransportForTests, validateOpenRouterKey } from "@/lib/openrouter";
import type { QuestionBlockConfig } from "@/lib/quiz";
import { POST as submitAnswer } from "@/app/api/attempts/[id]/answers/route";
import { POST as navigateAttempt } from "@/app/api/attempts/[id]/navigate/route";
import { POST as runEvaluation } from "@/app/api/attempts/[id]/outline/route";
import { POST as submitAttempt } from "@/app/api/attempts/[id]/submit/route";
import { POST as createConferenceAssessment } from "@/app/api/conference/[token]/route";
import { POST as gradeConferenceAttempt } from "@/app/api/attempts/[id]/grade/route";
import { GET as getOpenRouterCredentialStatus } from "@/app/api/openrouter/credential/route";
import {
  GET as getExamineeFeedback,
  POST as submitExamineeFeedback,
} from "@/app/api/attempts/[id]/feedback/route";
import {
  deleteTemplate,
  saveTemplate,
  setConferenceTemplateSharing,
} from "@/lib/templates";

let activeProviderCalls = 0;
let maxProviderCalls = 0;

setOpenRouterTransportForTests(async (input, init) => {
  const url = String(input);
  if (url.endsWith("/key")) {
    if (String((init?.headers as Record<string, string> | undefined)?.Authorization).includes("unsafe")) {
      return Response.json({ data: { label: "unsafe", limit: null, expires_at: null } });
    }
    return Response.json({
      data: {
        label: "test",
        limit: 10,
        limit_remaining: 10,
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
  }
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
    `sk-or-${suffix}-secret`,
  );
}

describe("public demo account-to-grade flow", () => {
  it("hashes credentials and keeps sessions separate", async () => {
    const alice = await registerAccount({
      username: "Alice.Test",
      password: "long-password-alice",
    });
    const bob = await registerAccount({
      username: "Bob.Test",
      password: "long-password-bob",
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
    await expect(
      validateOpenRouterKey("sk-or-unsafe", { requireSafeguards: true }),
    ).rejects.toThrow("spending limit");
    registerJobKey("restart-example", "sk-or-memory-only");
    clearJobKeys();
    expect(() => requireJobKey("restart-example")).toThrow("interrupted");
  });

  it("generates, takes, and grades a mixed assessment without network access", async () => {
    const alice = await db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get();
    if (!alice) throw new Error("Alice fixture missing.");
    const queued = await enqueueSet(alice.id, "complete-flow");
    const completed = await waitForJob(queued.jobId, alice.id);
    const generatedSetId = String(
      (completed.result as { questionSetId?: string })?.questionSetId ?? "",
    );
    expect(generatedSetId).toBeTruthy();
    expect(
      await db.select().from(attempts).where(eq(attempts.questionSetId, generatedSetId)),
    ).toHaveLength(0);
    const generatedSet = await db
      .select()
      .from(questionSets)
      .where(eq(questionSets.id, generatedSetId))
      .get();
    expect(generatedSet?.randomize).toBe(false);
    expect(generatedSet?.countdownHidden).toBe(false);
    const shared = await createQuestionSetShareLink(generatedSetId, alice.id);
    const bob = await db
      .select()
      .from(users)
      .where(eq(users.usernameNormalized, "bob.test"))
      .get();
    if (!bob) throw new Error("Bob fixture missing.");
    const token = shared.participantPath.split("/").pop();
    if (!token) throw new Error("Share token missing.");
    const first = await getOrCreateTakerAttempt(token, bob);
    const repeated = await getOrCreateTakerAttempt(token, bob);
    expect(repeated.attemptId).toBe(first.attemptId);
    const carol = await registerAccount({
      username: "Carol.Test",
      password: "long-password-carol",
    });
    const carolAttempt = await getOrCreateTakerAttempt(token, carol);
    expect(carolAttempt.attemptId).not.toBe(first.attemptId);
    const attemptId = first.attemptId;
    sessionState.token = await createAccountSession(bob.id);
    await requireOpenAttempt(attemptId, { claim: true });

    await getAttemptState(attemptId);
    let context = await loadAttemptContext(attemptId);
    if (context.currentQuestion.type !== "multiple_choice") throw new Error("Expected MC first.");
    let response: Response = await submitAnswer(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: context.currentQuestion.id,
          answer: {
            type: "multiple_choice",
            optionId: context.currentQuestion.correctOptionId,
          },
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(200);

    response = await navigateAttempt(
      new Request("http://localhost/api/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: 1 }),
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
        body: JSON.stringify({
          questionId: context.currentQuestion.id,
          answer: { type: "free_response", response: "The main contribution." },
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(200);

    await saveOpenRouterCredential(alice.id, "sk-or-professor-course-secret");
    const storedCredentialStatus = await credentialStatus(alice.id);
    expect(storedCredentialStatus).toMatchObject({ connected: true });
    expect(storedCredentialStatus).not.toHaveProperty("label");
    expect(JSON.stringify(storedCredentialStatus)).not.toContain("sk-or-");
    const takerSession = sessionState.token;
    sessionState.token = await createAccountSession(alice.id);
    const credentialStatusResponse = await getOpenRouterCredentialStatus();
    expect(credentialStatusResponse.status).toBe(200);
    const publicCredentialStatus = await credentialStatusResponse.json();
    expect(publicCredentialStatus).not.toHaveProperty("label");
    expect(JSON.stringify(publicCredentialStatus)).not.toContain("sk-or-");
    sessionState.token = takerSession;
    response = await submitAttempt(
      new Request("http://localhost/api/submit", { method: "POST" }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(202);
    const submitted = await response.json() as {
      pendingEvaluation: boolean;
      gradingCredentialRequired: boolean;
      grading: { jobId: string };
    };
    expect(submitted).toMatchObject({
      pendingEvaluation: true,
      gradingCredentialRequired: false,
    });
    const queuedGrading = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, submitted.grading.jobId))
      .get();
    expect(JSON.parse(queuedGrading?.payloadJson ?? "{}")).toMatchObject({
      attemptId,
      credentialOwnerUserId: alice.id,
    });
    // A course grading job resolves the encrypted professor credential at execution time and
    // therefore does not depend on the process-local key map.
    clearJobKeys();
    const pending = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
    expect(["submitted", "graded"]).toContain(pending?.status);
    expect((await listTakerAttempts(bob.id)).map((entry) => entry.id)).toContain(attemptId);
    expect((await listTakerAttempts(carol.id)).map((entry) => entry.id)).not.toContain(attemptId);

    const denied = await runEvaluation(
      new Request("http://localhost/api/attempts/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey: "sk-or-evaluation-secret", keySource: "paste" }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    // Owner-only resources deliberately look nonexistent to other accounts.
    expect(denied.status).toBe(404);

    await waitForJob(submitted.grading.jobId, alice.id);
    const grading = await getAttemptGradingJob(attemptId);
    expect(grading.status).toBe("completed");
    expect((grading.result as { overallScore: number }).overallScore).toBe(100);
    const claimed = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
    expect(claimed?.takerUserId).toBe(bob.id);
    expect(claimed?.takerUsername).toBe(bob.username);
    expect(JSON.stringify(await db.select().from(jobs))).not.toContain("sk-or-");
    expect(JSON.stringify(await db.select().from(openRouterCredentials))).not.toContain(
      "sk-or-professor-course-secret",
    );
    const exportHeader = (await buildAnswerCsv(alice.id)).split(/\r?\n/, 1)[0].split(",");
    expect(exportHeader).toEqual([
      "attempt_id", "question_set_id", "set_name", "paper_name", "model_id",
      "workflow_type", "attempt_status", "attempt_score", "randomize",
      "countdown_hidden", "attempt_created_at", "attempt_completed_at", "position",
      "question_id", "block_name", "question_type", "warmup", "time_limit_seconds",
      "started_at", "first_interaction_at", "first_interaction_ms", "submitted_at",
      "duration_ms", "overrun_ms", "score", "skipped", "timed_out", "response",
      "correct_answer", "correct", "grader_feedback", "examinee_feedback",
      "examinee_feedback_submitted_at",
    ]);
    sessionState.token = await createAccountSession(bob.id);
    expect((await getAttemptState(attemptId)).result?.overallScore).toBe(100);
    const emptyFeedback = await submitExamineeFeedback(
      new Request("http://localhost/api/attempts/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentsByQuestionId: {} }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(emptyFeedback.status).toBe(200);
    expect(await emptyFeedback.json()).toMatchObject({
      submitted: true,
      feedback: { commentsByQuestionId: {} },
    });
    sessionState.token = "";
  });

  it("runs the examinee-funded conference flow and locks post-grade feedback", async () => {
    const [alice, bob, carol] = await Promise.all([
      db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get(),
      db.select().from(users).where(eq(users.usernameNormalized, "bob.test")).get(),
      db.select().from(users).where(eq(users.usernameNormalized, "carol.test")).get(),
    ]);
    if (!alice || !bob || !carol) throw new Error("Account fixtures missing.");

    const incompleteTemplate = await saveTemplate(
      alice.id,
      "Incomplete conference template",
      {
        modelId: "",
        pdfEngine: "native",
        blocks: [],
        randomize: false,
        countdownHidden: false,
        overallTimeLimitSeconds: null,
      },
      "conference",
    );
    await expect(
      setConferenceTemplateSharing(incompleteTemplate.id, alice.id, true),
    ).rejects.toThrow("Choose a model");

    const template = await saveTemplate(
      alice.id,
      "Conference author check",
      {
        modelId: "test/model",
        pdfEngine: "native",
        blocks,
        randomize: false,
        countdownHidden: false,
        overallTimeLimitSeconds: null,
      },
      "conference",
    );
    await expect(
      saveTemplate(
        alice.id,
        "conference AUTHOR check",
        {
          modelId: "test/model",
          pdfEngine: "native",
          blocks,
          randomize: false,
          countdownHidden: false,
          overallTimeLimitSeconds: null,
        },
        "conference",
      ),
    ).rejects.toThrow("already have a test");
    await expect(
      saveTemplate(
        alice.id,
        "Conference author check",
        {
          modelId: "test/model",
          pdfEngine: "native",
          blocks,
          randomize: true,
          countdownHidden: false,
          overallTimeLimitSeconds: null,
        },
        "conference",
        template.id,
      ),
    ).resolves.toMatchObject({ id: template.id });
    const sharing = await setConferenceTemplateSharing(template.id, alice.id, true);
    if (!sharing.conferenceShareToken) throw new Error("Conference token missing.");

    sessionState.token = await createAccountSession(bob.id);
    const form = new FormData();
    form.set(
      "paper",
      new Blob(["%PDF-1.7 conference"], { type: "application/pdf" }),
      "conference.pdf",
    );
    form.set("contributions", "Designed and evaluated the method.");
    form.set("openrouterApiKey", "sk-or-conference-generation-secret");
    form.set("keySource", "paste");
    const generationResponse = await createConferenceAssessment(
      new Request("http://localhost/api/conference/token", {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ token: sharing.conferenceShareToken }) },
    );
    expect(generationResponse.status).toBe(202);
    const generation = await generationResponse.json() as { jobId: string };
    expect((await getConferenceJob(generation.jobId, bob.id)).status).toMatch(
      /queued|running|completed/,
    );
    const generated = await waitForJob(generation.jobId, bob.id);
    const attemptId = String(
      (generated.result as { attemptId?: string } | null)?.attemptId ?? "",
    );
    expect(attemptId).toBeTruthy();

    await getAttemptState(attemptId);
    let context = await loadAttemptContext(attemptId);
    if (context.currentQuestion.type !== "multiple_choice") throw new Error("Expected MC first.");
    const multipleChoiceQuestionId = context.currentQuestion.id;
    let response: Response = await submitAnswer(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: context.currentQuestion.id,
          answer: {
            type: "multiple_choice",
            optionId: context.currentQuestion.correctOptionId,
          },
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(200);
    response = await navigateAttempt(
      new Request("http://localhost/api/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: 1 }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(200);
    context = await loadAttemptContext(attemptId);
    if (context.currentQuestion.type !== "free_response") throw new Error("Expected free response.");
    const freeResponseQuestionId = context.currentQuestion.id;
    response = await submitAnswer(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: context.currentQuestion.id,
          answer: { type: "free_response", response: "The main contribution." },
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(response.status).toBe(200);

    const submitResponse = await submitAttempt(
      new Request("http://localhost/api/submit", { method: "POST" }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(submitResponse.status).toBe(202);
    expect(await submitResponse.json()).toMatchObject({
      pendingEvaluation: true,
      gradingCredentialRequired: true,
    });
    expect((await getAttemptGradingJob(attemptId)).status).toBe("not_started");

    const gradeResponse = await gradeConferenceAttempt(
      new Request("http://localhost/api/attempts/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openrouterApiKey: "sk-or-conference-grading-secret",
          keySource: "paste",
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(gradeResponse.status).toBe(202);
    const grading = await gradeResponse.json() as { jobId: string };
    await waitForJob(grading.jobId, alice.id);

    const unknownQuestionFeedback = await submitExamineeFeedback(
      new Request("http://localhost/api/attempts/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentsByQuestionId: { "not-this-attempt": "Should be rejected." },
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(unknownQuestionFeedback.status).toBe(400);

    const feedbackResponse = await submitExamineeFeedback(
      new Request("http://localhost/api/attempts/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentsByQuestionId: {
            [multipleChoiceQuestionId]: "The choices were clear.",
            [freeResponseQuestionId]: "The grading explanation was clear.",
          },
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(feedbackResponse.status).toBe(200);
    const duplicateFeedback = await submitExamineeFeedback(
      new Request("http://localhost/api/attempts/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commentsByQuestionId: {
            [freeResponseQuestionId]: "Changed feedback",
          },
        }),
      }),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(duplicateFeedback.status).toBe(409);
    const storedFeedback = await getExamineeFeedback(
      new Request("http://localhost/api/attempts/feedback"),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(await storedFeedback.json()).toMatchObject({
      submitted: true,
      feedback: {
        commentsByQuestionId: {
          [multipleChoiceQuestionId]: "The choices were clear.",
          [freeResponseQuestionId]: "The grading explanation was clear.",
        },
      },
    });
    expect(
      (await getAttemptOutline(attemptId)).examineeFeedback?.commentsByQuestionId,
    ).toMatchObject({
      [multipleChoiceQuestionId]: "The choices were clear.",
      [freeResponseQuestionId]: "The grading explanation was clear.",
    });

    const exported = await buildAnswerCsv(alice.id);
    const [headerLine, ...dataLines] = exported.trim().split(/\r?\n/);
    const header = headerLine.split(",");
    const attemptIndex = header.indexOf("attempt_id");
    const questionIndex = header.indexOf("question_id");
    const feedbackIndex = header.indexOf("examinee_feedback");
    const exportedRows = dataLines.map((line) => line.split(","));
    expect(
      exportedRows.find(
        (row) =>
          row[attemptIndex] === attemptId && row[questionIndex] === multipleChoiceQuestionId,
      )?.[feedbackIndex],
    ).toBe("The choices were clear.");
    expect(
      exportedRows.find(
        (row) =>
          row[attemptIndex] === attemptId && row[questionIndex] === freeResponseQuestionId,
      )?.[feedbackIndex],
    ).toBe("The grading explanation was clear.");

    sessionState.token = await createAccountSession(carol.id);
    const deniedFeedback = await getExamineeFeedback(
      new Request("http://localhost/api/attempts/feedback"),
      { params: Promise.resolve({ id: attemptId }) },
    );
    expect(deniedFeedback.status).toBe(400);
    expect(JSON.stringify(await db.select().from(jobs))).not.toContain(
      "sk-or-conference",
    );
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
    const [aliceResult] = await Promise.all([
      waitForJob(aliceJob.jobId, alice.id),
      waitForJob(bobJob.jobId, bob.id),
    ]);
    expect(maxProviderCalls).toBeLessThanOrEqual(2);
    await expect(getOwnedJob(aliceJob.jobId, bob.id)).rejects.toThrow("Job not found");

    const aliceSetId = (aliceResult.result as { questionSetId: string }).questionSetId;
    expect(
      await db.select().from(attempts).where(eq(attempts.questionSetId, aliceSetId)),
    ).toHaveLength(0);
    await expect(getQuestionSetOverview(aliceSetId, bob.id)).rejects.toThrow(
      "Question set not found",
    );
    const aliceShare = await createQuestionSetShareLink(aliceSetId, alice.id);
    const aliceToken = aliceShare.participantPath.split("/").pop();
    if (!aliceToken) throw new Error("Share token missing.");
    const { attemptId: aliceAttemptId } = await getOrCreateTakerAttempt(aliceToken, alice);

    const extra = await Promise.allSettled([
      enqueueSet(alice.id, "race-one"),
      enqueueSet(alice.id, "race-two"),
    ]);
    expect(extra.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accepted = extra.find((result) => result.status === "fulfilled");
    if (accepted?.status === "fulfilled") await waitForJob(accepted.value.jobId, alice.id);

    const duplicate = await Promise.all([
      enqueueGradingJob(aliceAttemptId, { apiKey: "sk-or-race-secret" }),
      enqueueGradingJob(aliceAttemptId, { apiKey: "sk-or-race-secret" }),
    ]);
    expect(duplicate[0].jobId).toBe(duplicate[1].jobId);
    expect((await db.select().from(jobs).where(and(
      eq(jobs.attemptId, aliceAttemptId),
      eq(jobs.type, "grading"),
    ))).length).toBe(1);
  });

  it("groups created tests and distinguishes attempt deletion from whole-test deletion", async () => {
    const [alice, bob] = await Promise.all([
      db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get(),
      db.select().from(users).where(eq(users.usernameNormalized, "bob.test")).get(),
    ]);
    if (!alice || !bob) throw new Error("Account fixtures missing.");

    const before = await listCreatedTests(alice.id);
    const conference = before.find(
      (test) => test.workflowType === "conference" && test.name === "Conference author check",
    );
    expect(conference?.invitationPath).toMatch(/^\/conference\//);
    expect(conference?.attempts.length).toBeGreaterThan(0);
    expect(before.some((test) => test.workflowType === "course" && test.attempts.length === 0))
      .toBe(true);

    const courseWithAttempt = before.find(
      (test) => test.workflowType === "course" && test.attempts.length > 0,
    );
    if (!courseWithAttempt) throw new Error("Course test fixture missing.");
    const removedAttempt = courseWithAttempt.attempts[0];
    await deleteAttempt(removedAttempt.id, alice.id);
    const afterAttemptDelete = await listCreatedTests(alice.id);
    expect(afterAttemptDelete.find((test) => test.id === courseWithAttempt.id)).toBeTruthy();
    expect(
      afterAttemptDelete
        .find((test) => test.id === courseWithAttempt.id)
        ?.attempts.some((attempt) => attempt.id === removedAttempt.id),
    ).toBe(false);

    const emptyCourse = afterAttemptDelete.find(
      (test) => test.workflowType === "course" && test.attempts.length === 0,
    );
    if (!emptyCourse) throw new Error("Empty Course test fixture missing.");
    await deleteQuestionSet(emptyCourse.id, alice.id);
    expect((await listCreatedTests(alice.id)).some((test) => test.id === emptyCourse.id)).toBe(false);

    if (!conference) throw new Error("Conference test fixture missing.");
    const conferenceSetIds = conference.attempts.map((attempt) => attempt.questionSetId);
    const conferenceAttemptIds = conference.attempts.map((attempt) => attempt.id);
    const bobBefore = await listCreatedTests(bob.id);
    await deleteTemplate(conference.id, alice.id);

    expect(
      await db.select().from(studyTemplates).where(eq(studyTemplates.id, conference.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(conferenceSubmissions)
        .where(eq(conferenceSubmissions.templateId, conference.id)),
    ).toHaveLength(0);
    for (const setId of conferenceSetIds) {
      expect(await db.select().from(questionSets).where(eq(questionSets.id, setId))).toHaveLength(0);
    }
    for (const attemptId of conferenceAttemptIds) {
      expect(await db.select().from(attempts).where(eq(attempts.id, attemptId))).toHaveLength(0);
      expect(await db.select().from(jobs).where(eq(jobs.attemptId, attemptId))).toHaveLength(0);
    }
    expect(await listCreatedTests(bob.id)).toEqual(bobBefore);
  });
});
