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
  attemptAnswers,
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
import { closeForTimeout } from "@/lib/attempt-close";
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
  getInvitationJob,
  getAttemptGradingJob,
  getOwnedJob,
} from "@/lib/jobs";
import { clearJobKeys, registerJobKey, requireJobKey } from "@/lib/openrouter-key-store";
import { credentialStatus } from "@/lib/openrouter-credentials";
import { OpenRouterError } from "@/lib/openrouter-errors";
import { setOpenRouterTransportForTests, validateOpenRouterKey } from "@/lib/openrouter";
import type { AssessmentResult, QuestionBlockConfig } from "@/lib/quiz";
import { POST as submitAnswer } from "@/app/api/attempts/[id]/answers/route";
import { POST as navigateAttempt } from "@/app/api/attempts/[id]/navigate/route";
import { POST as runEvaluation } from "@/app/api/attempts/[id]/outline/route";
import { POST as submitAttempt } from "@/app/api/attempts/[id]/submit/route";
import { POST as createInvitationAssessment } from "@/app/api/invitations/[token]/route";
import { POST as uploadTemplateMaterial } from "@/app/api/templates/[id]/material/route";
import { POST as changePassword } from "@/app/api/account/password/route";
import { POST as gradeTakerFundedAttempt } from "@/app/api/attempts/[id]/grade/route";
import {
  GET as getOpenRouterCredentialStatus,
  POST as saveOpenRouterCredential,
} from "@/app/api/openrouter/credential/route";
import {
  GET as getExamineeFeedback,
  POST as submitExamineeFeedback,
} from "@/app/api/attempts/[id]/feedback/route";
import {
  deleteTemplate,
  saveTemplate,
  setTemplateSharing,
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
    const prompt = body.messages?.[0]?.content?.find((part) => part.text)?.text ?? "";
    const requestedCandidates = Number(
      /Generate exactly (\d+) candidate/.exec(prompt)?.[1] ?? "1",
    );
    let content: unknown;
    if (schema === "research_captcha_multiple_choice_questions") {
      content = {
        questions: Array.from({ length: requestedCandidates }, (_, index) => ({
          prompt: `Which result is reported in candidate ${index + 1}?`,
          description: `Checks reported result candidate ${index + 1}.`,
          page: index + 3,
          answer: `Result A${index + 1}`,
          distractors: [`Result B${index + 1}`, `Result C${index + 1}`, `Result D${index + 1}`],
          rationale: `The paper reports Result A${index + 1}.`,
        })),
      };
    } else if (schema === "research_captcha_free_response_questions") {
      content = {
        questions: Array.from({ length: requestedCandidates }, (_, index) => ({
          prompt: `Explain contribution candidate ${index + 1}.`,
          description: `Checks contribution candidate ${index + 1}.`,
          page: index + 7,
          rubric: {
            summary: "Names the contribution.",
            criteria: [{ criterion: "Correct contribution", points: 100, guidance: "Accept equivalents." }],
          },
        })),
      };
    } else if (schema === "research_captcha_fill_questions") {
      content = {
        questions: Array.from({ length: requestedCandidates }, (_, index) => ({
          prompt: `Candidate ${index + 1} uses {{method}}.`,
          description: `Checks method candidate ${index + 1}.`,
          page: index + 1,
          blanks: [{
            id: "method",
            answer: `Method A${index + 1}`,
            distractors: [`Method B${index + 1}`, `Method C${index + 1}`],
          }],
        })),
      };
    } else if (schema === "research_captcha_free_response_grades") {
      const marker = "Questions, rubrics, and responses:\n";
      const items = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as Array<{
        questionId: string;
        rubric: { criteria: Array<{ criterionIndex: number; points: number }> };
      }>;
      content = {
        grades: items.map((item) => ({
          questionId: item.questionId,
          feedback: "Correct.",
          // Full marks on every criterion, each resting on a verbatim quote of the response.
          criteria: item.rubric.criteria.map((criterion) => ({
            criterionIndex: criterion.criterionIndex,
            pointsAwarded: criterion.points,
            justification: "Names the contribution.",
            evidence: ["main contribution"],
          })),
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
    candidatePoolSize: 3,
    optionsPerQuestion: 4,
    warmup: false,
    prompt: "Ask one factual question.",
  },
  {
    id: "free",
    type: "free_response",
    name: "Explanation",
    count: 1,
    candidatePoolSize: 3,
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
      apiKeyPayer: "creator",
      materialUploader: "creator",
      contributions: "All sections",
      modelId: "test/model",
      pdfEngine: "native",
      randomize: false,
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

    sessionState.token = aliceToken;
    const passwordRequest = (body: Record<string, string>) =>
      changePassword(
        new Request("http://localhost/api/account/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect(
      (
        await passwordRequest({
          currentPassword: "wrong-current-password",
          newPassword: "new-long-password-alice",
          passwordConfirmation: "new-long-password-alice",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await passwordRequest({
          currentPassword: "long-password-alice",
          newPassword: "new-long-password-alice",
          passwordConfirmation: "different-confirmation",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await passwordRequest({
          currentPassword: "long-password-alice",
          newPassword: "short",
          passwordConfirmation: "short",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await passwordRequest({
          currentPassword: "long-password-alice",
          newPassword: "long-password-alice",
          passwordConfirmation: "long-password-alice",
        })
      ).status,
    ).toBe(400);
    const changedPassword = await passwordRequest({
      currentPassword: "long-password-alice",
      newPassword: "new-long-password-alice",
      passwordConfirmation: "new-long-password-alice",
    });
    expect(changedPassword.status).toBe(200);
    const rotatedToken = /rc_session=([^;]+)/.exec(
      changedPassword.headers.get("set-cookie") ?? "",
    )?.[1];
    expect(rotatedToken).toBeTruthy();
    expect(await accountForSession(aliceToken)).toBeNull();
    expect(await accountForSession(decodeURIComponent(rotatedToken ?? ""))).toMatchObject({
      id: alice.id,
    });
    expect(await authenticateAccount("alice.test", "long-password-alice")).toBeNull();
    expect(
      (await authenticateAccount("alice.test", "new-long-password-alice"))?.id,
    ).toBe(alice.id);
    expect((await accountForSession(bobToken))?.id).toBe(bob.id);
    sessionState.token = "";

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
    // Key problems are tagged as OpenRouter errors, so the forms show them by the key controls.
    await expect(
      validateOpenRouterKey("sk-or-unsafe", { requireSafeguards: true }),
    ).rejects.toBeInstanceOf(OpenRouterError);
    registerJobKey("restart-example", "sk-or-memory-only");
    clearJobKeys();
    expect(() => requireJobKey("restart-example")).toThrow("interrupted");
    expect(() => requireJobKey("restart-example")).toThrow(OpenRouterError);
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
    // Stored in page order, each question keeping the page it was generated from.
    const storedQuestions = JSON.parse(generatedSet?.questionsJson ?? "[]") as Array<{
      type: string;
      sourcePage?: number;
    }>;
    expect(storedQuestions.map((question) => question.type)).toEqual([
      "multiple_choice",
      "free_response",
    ]);
    expect([3, 4, 5]).toContain(storedQuestions[0].sourcePage);
    expect([7, 8, 9]).toContain(storedQuestions[1].sourcePage);
    const shared = await createQuestionSetShareLink(generatedSetId, alice.id);
    expect(
      (await listCreatedTests(alice.id)).find((test) => test.id === generatedSetId),
    ).toMatchObject({
      invitationEnabled: true,
      invitationPath: shared.participantPath,
    });
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
    if (context.currentQuestion.type !== "multiple_choice") {
      throw new Error("Expected a multiple-choice question.");
    }
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

    const takerSession = sessionState.token;
    sessionState.token = await createAccountSession(alice.id);
    const unsafeCredentialResponse = await saveOpenRouterCredential(
      new Request("http://localhost/api/openrouter/credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey: "sk-or-unsafe" }),
      }),
    );
    expect(unsafeCredentialResponse.status).toBe(400);
    expect(await credentialStatus(alice.id)).toEqual({ connected: false });

    for (const openrouterApiKey of [
      "sk-or-professor-course-first",
      "sk-or-professor-course-secret",
    ]) {
      const saveCredentialResponse = await saveOpenRouterCredential(
        new Request("http://localhost/api/openrouter/credential", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ openrouterApiKey }),
        }),
      );
      expect(saveCredentialResponse.status).toBe(200);
      expect(JSON.stringify(await saveCredentialResponse.json())).not.toContain("sk-or-");
    }
    const storedCredentialStatus = await credentialStatus(alice.id);
    expect(storedCredentialStatus).toMatchObject({ connected: true });
    expect(storedCredentialStatus).not.toHaveProperty("label");
    expect(JSON.stringify(storedCredentialStatus)).not.toContain("sk-or-");
    const credentialRows = await db
      .select()
      .from(openRouterCredentials)
      .where(eq(openRouterCredentials.userId, alice.id));
    expect(credentialRows).toHaveLength(1);
    expect(JSON.stringify(credentialRows)).not.toContain("sk-or-professor");
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
    // Free responses carry per-criterion marks and the located evidence behind them.
    const freeReview = (grading.result as AssessmentResult).questions.find(
      (review) => review.type === "free_response",
    );
    if (freeReview?.type !== "free_response") throw new Error("Expected a free-response review.");
    expect(freeReview.criterionGrades).toEqual([
      {
        criterion: "Correct contribution",
        points: 100,
        awarded: 100,
        justification: "Names the contribution.",
        spans: [{ start: 4, end: 21 }],
      },
    ]);
    expect(freeReview.response.slice(4, 21)).toBe("main contribution");
    const claimed = await db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
    expect(claimed?.takerUserId).toBe(bob.id);
    expect(claimed?.takerUsername).toBe(bob.username);
    expect(JSON.stringify(await db.select().from(jobs))).not.toContain("sk-or-");
    expect(JSON.stringify(await db.select().from(openRouterCredentials))).not.toContain(
      "sk-or-professor-course-secret",
    );
    const exportHeader = (await buildAnswerCsv(alice.id)).split(/\r?\n/, 1)[0].split(",");
    // "Export selected": only the chosen sets' rows, and nothing for a set that is not the owner's.
    const allRows = (await buildAnswerCsv(alice.id)).trim().split(/\r?\n/).length;
    const selectedRows = (await buildAnswerCsv(alice.id, [generatedSetId])).trim().split(/\r?\n/);
    expect(selectedRows.length).toBeGreaterThan(1);
    expect(selectedRows.length).toBeLessThanOrEqual(allRows);
    expect(selectedRows.slice(1).every((line) => line.includes(generatedSetId))).toBe(true);
    const rowsFor = async (owner: string, sets: string[]) =>
      (await buildAnswerCsv(owner, sets)).trim().split(/\r?\n/);
    expect(await rowsFor(alice.id, ["not-a-real-set"])).toHaveLength(1);
    expect(await rowsFor(bob.id, [generatedSetId])).toHaveLength(1);
    expect(exportHeader).toEqual([
      "attempt_id", "question_set_id", "set_name", "paper_name", "contributions", "model_id",
      "api_key_payer", "material_uploader", "attempt_status", "attempt_score", "randomize",
      "attempt_created_at", "attempt_completed_at", "position",
      "question_id", "block_name", "question_type", "warmup",
      "started_at", "first_interaction_at", "first_interaction_ms", "submitted_at",
      "duration_ms", "score", "skipped", "timed_out", "response",
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

  it("runs a test-taker-funded, test-taker-uploaded flow and locks post-grade feedback", async () => {
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
        overallTimeLimitSeconds: null,
      },
      "taker",
      "taker",
    );
    await expect(
      setTemplateSharing(incompleteTemplate.id, alice.id, true),
    ).rejects.toThrow("Choose a model");

    // A saved question configuration stays one: publishing an invitation from it must not
    // overwrite it.
    const questionTemplate = await saveTemplate(
      alice.id,
      "Reusable question configuration",
      {
        modelId: "test/model",
        pdfEngine: "native",
        blocks,
        randomize: false,
        overallTimeLimitSeconds: null,
      },
      "creator",
      "creator",
    );
    await expect(
      saveTemplate(
        alice.id,
        "Invitation from a configuration",
        {
          modelId: "test/model",
          pdfEngine: "native",
          blocks,
          randomize: false,
          overallTimeLimitSeconds: null,
        },
        "taker",
        "taker",
        questionTemplate.id,
      ),
    ).rejects.toThrow("cannot be turned into an invitation");

    const template = await saveTemplate(
      alice.id,
      "Conference author check",
      {
        modelId: "test/model",
        pdfEngine: "native",
        blocks,
        randomize: false,
        overallTimeLimitSeconds: null,
      },
      "taker",
      "taker",
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
          overallTimeLimitSeconds: null,
        },
        "taker",
        "taker",
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
          randomize: false,
          overallTimeLimitSeconds: 1800,
        },
        "taker",
        "taker",
        template.id,
      ),
    ).resolves.toMatchObject({ id: template.id });
    const sharing = await setTemplateSharing(template.id, alice.id, true);
    if (!sharing.invitationShareToken) throw new Error("Invitation token missing.");
    expect(
      (await listCreatedTests(alice.id)).find((test) => test.id === template.id),
    ).toMatchObject({
      invitationEnabled: true,
      invitationPath: `/invite/${sharing.invitationShareToken}`,
    });

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
    const generationResponse = await createInvitationAssessment(
      new Request("http://localhost/api/invitations/token", {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ token: sharing.invitationShareToken }) },
    );
    expect(generationResponse.status).toBe(202);
    const generation = await generationResponse.json() as { jobId: string };
    expect((await getInvitationJob(generation.jobId, bob.id)).status).toMatch(
      /queued|running|completed/,
    );
    const generated = await waitForJob(generation.jobId, bob.id);
    const attemptId = String(
      (generated.result as { attemptId?: string } | null)?.attemptId ?? "",
    );
    expect(attemptId).toBeTruthy();

    await getAttemptState(attemptId);
    let context = await loadAttemptContext(attemptId);
    const multipleChoiceIndex = context.order.findIndex(
      (questionId) => context.questionById.get(questionId)?.type === "multiple_choice",
    );
    const freeResponseIndex = context.order.findIndex(
      (questionId) => context.questionById.get(questionId)?.type === "free_response",
    );
    if (multipleChoiceIndex < 0 || freeResponseIndex < 0) {
      throw new Error("Expected one multiple-choice and one free-response question.");
    }
    let response: Response;
    if (context.attempt.currentIndex !== multipleChoiceIndex) {
      response = await navigateAttempt(
        new Request("http://localhost/api/navigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index: multipleChoiceIndex }),
        }),
        { params: Promise.resolve({ id: attemptId }) },
      );
      expect(response.status).toBe(200);
      context = await loadAttemptContext(attemptId);
    }
    if (context.currentQuestion.type !== "multiple_choice") throw new Error("Expected MC first.");
    const multipleChoiceQuestionId = context.currentQuestion.id;
    response = await submitAnswer(
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
        body: JSON.stringify({ index: freeResponseIndex }),
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

    const gradeResponse = await gradeTakerFundedAttempt(
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

  it("supports both mixed payer and material-uploader combinations", async () => {
    const [alice, bob] = await Promise.all([
      db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get(),
      db.select().from(users).where(eq(users.usernameNormalized, "bob.test")).get(),
    ]);
    if (!alice || !bob) throw new Error("Account fixtures missing.");

    const directOnly = await saveTemplate(
      alice.id,
      "Creator pays and uploads",
      {
        modelId: "test/model",
        pdfEngine: "native",
        blocks,
        randomize: false,
        overallTimeLimitSeconds: null,
      },
      "creator",
      "creator",
    );
    await expect(setTemplateSharing(directOnly.id, alice.id, true)).rejects.toThrow(
      "Generate this test",
    );

    for (const dimensions of [
      {
        name: "Creator uploads taker pays",
        apiKeyPayer: "taker" as const,
        materialUploader: "creator" as const,
      },
      {
        name: "Taker uploads creator pays",
        apiKeyPayer: "creator" as const,
        materialUploader: "taker" as const,
      },
    ]) {
      const template = await saveTemplate(
        alice.id,
        dimensions.name,
        {
          modelId: "test/model",
          pdfEngine: "native",
          blocks,
          randomize: false,
          overallTimeLimitSeconds: null,
        },
        dimensions.apiKeyPayer,
        dimensions.materialUploader,
      );

      sessionState.token = await createAccountSession(alice.id);
      if (dimensions.materialUploader === "creator") {
        const material = new FormData();
        material.set(
          "paper",
          new Blob(["%PDF-1.7 creator material"], { type: "application/pdf" }),
          "creator-material.pdf",
        );
        material.set("contributions", "Shared material selected by the creator.");
        const uploaded = await uploadTemplateMaterial(
          new Request("http://localhost/api/templates/id/material", {
            method: "POST",
            body: material,
          }),
          { params: Promise.resolve({ id: template.id }) },
        );
        expect(uploaded.status).toBe(200);
      }
      const sharing = await setTemplateSharing(template.id, alice.id, true);
      if (!sharing.invitationShareToken) throw new Error("Invitation token missing.");
      expect(
        (await listCreatedTests(alice.id)).find((test) => test.id === template.id),
      ).toMatchObject({
        invitationEnabled: true,
        invitationPath: `/invite/${sharing.invitationShareToken}`,
      });

      sessionState.token = await createAccountSession(bob.id);
      const form = new FormData();
      if (dimensions.materialUploader === "taker") {
        form.set(
          "paper",
          new Blob(["%PDF-1.7 taker material"], { type: "application/pdf" }),
          "taker-material.pdf",
        );
        form.set("contributions", "Material selected by the taker.");
      }
      if (dimensions.apiKeyPayer === "taker") {
        form.set("openrouterApiKey", "sk-or-mixed-workflow");
        form.set("keySource", "paste");
      }
      const response = await createInvitationAssessment(
        new Request("http://localhost/api/invitations/token", {
          method: "POST",
          body: form,
        }),
        { params: Promise.resolve({ token: sharing.invitationShareToken }) },
      );
      expect(response.status).toBe(202);
      const { jobId } = await response.json() as { jobId: string };
      const jobRow = await db.select().from(jobs).where(eq(jobs.id, jobId)).get();
      const jobPayload = JSON.parse(jobRow?.payloadJson ?? "{}") as {
        credentialOwnerUserId?: string;
      };
      expect(jobPayload.credentialOwnerUserId).toBe(
        dimensions.apiKeyPayer === "creator" ? alice.id : undefined,
      );
      const completed = await waitForJob(jobId, bob.id);
      const attemptId = String(
        (completed.result as { attemptId?: string } | null)?.attemptId ?? "",
      );
      const generated = await db
        .select({ set: questionSets })
        .from(attempts)
        .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
        .where(eq(attempts.id, attemptId))
        .get();
      expect(generated?.set).toMatchObject({
        apiKeyPayer: dimensions.apiKeyPayer,
        materialUploader: dimensions.materialUploader,
      });
      await deleteTemplate(template.id, alice.id);
    }
    await deleteTemplate(directOnly.id, alice.id);
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

  it("keeps duration telemetry while the overall limit marks unanswered items timed out", async () => {
    const [alice, bob] = await Promise.all([
      db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get(),
      db.select().from(users).where(eq(users.usernameNormalized, "bob.test")).get(),
    ]);
    if (!alice || !bob) throw new Error("Account fixtures missing.");

    const queued = await enqueueSet(alice.id, "overall-timeout");
    const completed = await waitForJob(queued.jobId, alice.id);
    const questionSetId = String(
      (completed.result as { questionSetId?: string })?.questionSetId ?? "",
    );
    await db
      .update(questionSets)
      .set({ overallTimeLimitSeconds: 30 })
      .where(eq(questionSets.id, questionSetId))
      .run();
    const shared = await createQuestionSetShareLink(questionSetId, alice.id);
    const token = shared.participantPath.split("/").pop();
    if (!token) throw new Error("Share token missing.");
    const { attemptId } = await getOrCreateTakerAttempt(token, bob);
    await getAttemptState(attemptId);
    await db
      .update(attempts)
      .set({ activeQuestionStartedAt: new Date(Date.now() - 31_000).toISOString() })
      .where(eq(attempts.id, attemptId))
      .run();

    await closeForTimeout(attemptId);
    const answers = await db
      .select()
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, attemptId));
    expect(answers).toHaveLength(blocks.length);
    expect(answers.every((answer) => answer.timedOut)).toBe(true);
    expect(Math.max(...answers.map((answer) => answer.durationMs ?? 0))).toBeGreaterThanOrEqual(
      30_000,
    );
  });

  it("groups created tests and distinguishes attempt deletion from whole-test deletion", async () => {
    const [alice, bob] = await Promise.all([
      db.select().from(users).where(eq(users.usernameNormalized, "alice.test")).get(),
      db.select().from(users).where(eq(users.usernameNormalized, "bob.test")).get(),
    ]);
    if (!alice || !bob) throw new Error("Account fixtures missing.");

    const before = await listCreatedTests(alice.id);
    const invitation = before.find(
      (test) =>
        test.apiKeyPayer === "taker" &&
        test.materialUploader === "taker" &&
        test.name === "Conference author check",
    );
    expect(invitation?.invitationPath).toMatch(/^\/invite\//);
    expect(invitation?.attempts.length).toBeGreaterThan(0);
    expect(
      before.some(
        (test) =>
          test.apiKeyPayer === "creator" &&
          test.materialUploader === "creator" &&
          test.attempts.length === 0,
      ),
    ).toBe(true);

    const generatedWithAttempt = before.find(
      (test) =>
        test.apiKeyPayer === "creator" &&
        test.materialUploader === "creator" &&
        test.attempts.length > 0,
    );
    if (!generatedWithAttempt) throw new Error("Generated test fixture missing.");
    const removedAttempt = generatedWithAttempt.attempts[0];
    await deleteAttempt(removedAttempt.id, alice.id);
    const afterAttemptDelete = await listCreatedTests(alice.id);
    expect(afterAttemptDelete.find((test) => test.id === generatedWithAttempt.id)).toBeTruthy();
    expect(
      afterAttemptDelete
        .find((test) => test.id === generatedWithAttempt.id)
        ?.attempts.some((attempt) => attempt.id === removedAttempt.id),
    ).toBe(false);

    const emptyGenerated = afterAttemptDelete.find(
      (test) =>
        test.apiKeyPayer === "creator" &&
        test.materialUploader === "creator" &&
        test.attempts.length === 0,
    );
    if (!emptyGenerated) throw new Error("Empty generated test fixture missing.");
    await deleteQuestionSet(emptyGenerated.id, alice.id);
    expect((await listCreatedTests(alice.id)).some((test) => test.id === emptyGenerated.id))
      .toBe(false);

    if (!invitation) throw new Error("Invitation fixture missing.");
    const invitationSetIds = invitation.attempts.map((attempt) => attempt.questionSetId);
    const invitationAttemptIds = invitation.attempts.map((attempt) => attempt.id);
    const bobBefore = await listCreatedTests(bob.id);
    await deleteTemplate(invitation.id, alice.id);

    expect(
      await db.select().from(studyTemplates).where(eq(studyTemplates.id, invitation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(conferenceSubmissions)
        .where(eq(conferenceSubmissions.templateId, invitation.id)),
    ).toHaveLength(0);
    for (const setId of invitationSetIds) {
      expect(await db.select().from(questionSets).where(eq(questionSets.id, setId))).toHaveLength(0);
    }
    for (const attemptId of invitationAttemptIds) {
      expect(await db.select().from(attempts).where(eq(attempts.id, attemptId))).toHaveLength(0);
      expect(await db.select().from(jobs).where(eq(jobs.attemptId, attemptId))).toHaveLength(0);
    }
    expect(await listCreatedTests(bob.id)).toEqual(bobBefore);
  });
});
