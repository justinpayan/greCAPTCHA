import { File } from "node:buffer";
import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "rc_session" && sessionState.token ? { value: sessionState.token } : undefined,
  }),
}));

import { db } from "@/db";
import { openRouterCredentials, questionSets } from "@/db/schema";
import { createAccountSession, registerAccount } from "@/lib/accounts";
import { bundleFromZip, serializeBundle } from "@/lib/code-bundle";
import { enqueueGenerationJob, getOwnedJob } from "@/lib/jobs";
import {
  assertEndpointAllowed,
  endpointById,
  endpointGroups,
  endpointsForUsername,
  EndpointConfigError,
} from "@/lib/llm-endpoints";
import {
  generateQuestionBlock,
  getOpenRouterModels,
  setOpenRouterTransportForTests,
  validateOpenRouterKey,
} from "@/lib/openrouter";
import {
  credentialStatus,
  requireOpenRouterCredential,
  saveOpenRouterCredential,
} from "@/lib/openrouter-credentials";
import type { QuestionBlockConfig } from "@/lib/quiz";
import { saveTemplate } from "@/lib/templates";
import { GET as listEndpoints } from "@/app/api/llm-endpoints/route";
import { strToU8, zipSync } from "fflate";

const CMU = "https://litellm.cmu.example.edu";
const VLLM = "https://vllm.other.example.org/v1";
const DAY = 24 * 60 * 60 * 1000;

const config = {
  cmu: { label: "CMU", baseUrl: `${CMU}/`, users: ["Instructor-A", "instructor-b"] },
  other: { label: "Other U", baseUrl: VLLM, kind: "openai", users: ["lecturer-c"], catalogKey: "sk-catalog" },
};

type Seen = { url: string; init?: RequestInit };
let seen: Seen[] = [];

/** A stand-in for every endpoint: answers by full URL, records each request. */
function stub(routes: Record<string, (init?: RequestInit) => Response>) {
  seen = [];
  setOpenRouterTransportForTests(async (input, init) => {
    const url = String(input);
    seen.push({ url, init });
    const route = routes[url];
    return route ? route(init) : Response.json({ error: { message: "Not found" } }, { status: 404 });
  });
}

const auth = (entry: Seen) => new Headers(entry.init?.headers).get("authorization");
const chat = (content: unknown) => () =>
  Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });

beforeEach(() => {
  vi.stubEnv("LLM_ENDPOINTS", JSON.stringify(config));
  vi.stubEnv("LLM_ENDPOINTS_FILE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("endpoint configuration", () => {
  it("assigns users to groups, matching usernames the way logins do", () => {
    expect(endpointsForUsername("instructor-a")).toEqual([
      { id: "openrouter", label: "OpenRouter" },
      { id: "cmu", label: "CMU" },
    ]);
    expect(endpointsForUsername("INSTRUCTOR-B")[1]?.id).toBe("cmu");
    expect(endpointsForUsername("student")).toEqual([{ id: "openrouter", label: "OpenRouter" }]);
    expect(endpointById("cmu")).toMatchObject({ kind: "litellm", baseUrl: CMU });
    expect(endpointById("other")).toMatchObject({ kind: "openai", baseUrl: VLLM, catalogKey: "sk-catalog" });
  });

  it("lets users choose only OpenRouter or their own group", () => {
    expect(() => assertEndpointAllowed("student", "openrouter")).not.toThrow();
    expect(() => assertEndpointAllowed("instructor-a", "cmu")).not.toThrow();
    expect(() => assertEndpointAllowed("instructor-a", "other")).toThrow(/not set up to use that model endpoint/);
    expect(() => assertEndpointAllowed("student", "cmu")).toThrow(/not set up/);
  });

  it("refuses a malformed configuration with a message naming the problem", () => {
    const refuses = (value: unknown, message: RegExp) => {
      vi.stubEnv("LLM_ENDPOINTS", typeof value === "string" ? value : JSON.stringify(value));
      expect(() => endpointGroups()).toThrow(EndpointConfigError);
      expect(() => endpointGroups()).toThrow(message);
    };
    refuses("{not json", /not valid JSON/);
    refuses([], /object of groups/);
    refuses({ openrouter: { label: "X", baseUrl: CMU } }, /not “openrouter”/);
    refuses({ "Bad ID": { label: "X", baseUrl: CMU } }, /lowercase letters/);
    refuses({ cmu: { baseUrl: CMU } }, /label/);
    refuses({ cmu: { label: "CMU", baseUrl: "not a url" } }, /not a URL/);
    refuses({ cmu: { label: "CMU", baseUrl: "ftp://x.example" } }, /http or https/);
    refuses({ cmu: { label: "CMU", baseUrl: "https://u:sk-secret@x.example" } }, /credentials/);
    refuses(
      { cmu: { label: "CMU", baseUrl: CMU, users: ["a-user"] }, pitt: { label: "Pitt", baseUrl: CMU, users: ["A-User"] } },
      /in both “cmu” and “pitt”/,
    );
    vi.stubEnv("LLM_ENDPOINTS_FILE", "/somewhere.json");
    expect(() => endpointGroups()).toThrow(/not both/);
  });

  it("reads the same JSON from a file", () => {
    const file = path.join(process.cwd(), "data", "vitest", "endpoints.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pitt: { label: "Pitt", baseUrl: CMU, users: ["p-user"] } }));
    vi.stubEnv("LLM_ENDPOINTS", "");
    vi.stubEnv("LLM_ENDPOINTS_FILE", file);
    expect(endpointsForUsername("p-user")[1]).toEqual({ id: "pitt", label: "Pitt" });
  });

  it("reports a test whose group was removed instead of failing obscurely", () => {
    expect(() => endpointById("gone")).toThrow("This test's model endpoint is no longer configured on this server.");
  });
});

describe("institution keys", () => {
  it("keeps the budget and expiry a LiteLLM gateway reports", async () => {
    const expires = new Date(Date.now() + 30 * DAY).toISOString();
    stub({
      [`${CMU}/key/info`]: () =>
        Response.json({ info: { key_alias: "course", max_budget: 10, spend: 2.5, expires, status: "active" } }),
    });
    await expect(validateOpenRouterKey("sk-cmu", { endpoint: "cmu", requireSafeguards: true })).resolves.toEqual({
      limit: 10,
      limitRemaining: 7.5,
      expiresAt: expires,
      label: "course",
    });
    expect(auth(seen[0])).toBe("Bearer sk-cmu");
  });

  it("accepts a key that can list models when the gateway will not describe it", async () => {
    stub({
      [`${CMU}/key/info`]: () => Response.json({ error: "forbidden" }, { status: 403 }),
      [`${CMU}/models`]: () => Response.json({ data: [{ id: "claude" }] }),
    });
    await expect(validateOpenRouterKey("sk-cmu", { endpoint: "cmu", requireSafeguards: true })).resolves.toEqual({
      limit: null,
      limitRemaining: null,
      expiresAt: null,
      label: null,
    });
  });

  it("refuses a rejected, blocked, or spent key", async () => {
    stub({ [`${CMU}/key/info`]: () => Response.json({}, { status: 401 }) });
    await expect(validateOpenRouterKey("sk-bad", { endpoint: "cmu" })).rejects.toThrow("CMU rejected that API key.");
    stub({ [`${CMU}/key/info`]: () => Response.json({ info: { blocked: true, status: "blocked" } }) });
    await expect(validateOpenRouterKey("sk-cmu", { endpoint: "cmu" })).rejects.toThrow(/blocked/);
    stub({ [`${CMU}/key/info`]: () => Response.json({ info: { max_budget: 5, spend: 5 } }) });
    await expect(validateOpenRouterKey("sk-cmu", { endpoint: "cmu" })).rejects.toThrow(/spent its budget/);
  });

  it("checks a key for a plain OpenAI-compatible server by listing its models", async () => {
    stub({ [`${VLLM}/models`]: () => Response.json({ data: [] }) });
    await validateOpenRouterKey("sk-other", { endpoint: "other" });
    expect(seen.map((entry) => entry.url)).toEqual([`${VLLM}/models`]);
    stub({ [`${VLLM}/models`]: () => Response.json({}, { status: 401 }) });
    await expect(validateOpenRouterKey("sk-other", { endpoint: "other" })).rejects.toThrow("Other U rejected that API key.");
  });

  it("names the endpoint, not its address, when it cannot be reached", async () => {
    setOpenRouterTransportForTests(async () => {
      throw new TypeError("fetch failed");
    });
    const failure = validateOpenRouterKey("sk-cmu", { endpoint: "cmu" });
    await expect(failure).rejects.toThrow("CMU could not be reached. Try again in a moment.");
    await expect(failure).rejects.not.toThrow(/cmu\.example/);
  });
});

describe("institution models", () => {
  it("lists a LiteLLM key's chat models with prices and context sizes", async () => {
    stub({
      [`${CMU}/model/info`]: () =>
        Response.json({
          data: [
            { model_name: "claude", model_info: { max_input_tokens: 200000, input_cost_per_token: 0.000003, output_cost_per_token: 0.000015, mode: "chat" } },
            { model_name: "claude", model_info: {} },
            { model_name: "llama", model_info: { supports_pdf_input: false } },
            { model_name: "embedder", model_info: { mode: "embedding" } },
            { model_name: "openai/*", model_info: {} },
          ],
        }),
    });
    const models = await getOpenRouterModels("sk-cmu", "cmu");
    expect(models.map((model) => [model.id, model.contextLength, model.inputModalities, model.pricing])).toEqual([
      ["claude", 200000, ["text", "file"], { prompt: "0.000003", completion: "0.000015" }],
      ["llama", undefined, ["text"], undefined],
    ]);
  });

  it("falls back to the plain model list, and uses the catalog key when no user key is at hand", async () => {
    stub({
      [`${CMU}/model/info`]: () => Response.json({}, { status: 404 }),
      [`${CMU}/models`]: () => Response.json({ data: [{ id: "gpt" }, { id: "claude" }] }),
      [`${VLLM}/models`]: () => Response.json({ data: [{ id: "qwen" }] }),
    });
    expect((await getOpenRouterModels("sk-cmu", "cmu")).map((model) => model.id)).toEqual(["claude", "gpt"]);
    await expect(getOpenRouterModels(undefined, "cmu")).rejects.toThrow("Add your CMU API key to load its models.");
    expect((await getOpenRouterModels(undefined, "other")).map((model) => model.id)).toEqual(["qwen"]);
    expect(auth(seen.at(-1)!)).toBe("Bearer sk-catalog");
  });
});

const block: QuestionBlockConfig = {
  id: "fr", type: "free_response", name: "Rationale", count: 1, candidatePoolSize: 1, warmup: false, prompt: "Why.", rubricPrompt: "",
};

describe("institution requests", () => {
  it("sends the PDF to the group's address as a file input, without OpenRouter's plugin or headers", async () => {
    stub({ [`${CMU}/chat/completions`]: chat({ questions: [] }) });
    await generateQuestionBlock({
      apiKey: "sk-cmu",
      endpoint: "cmu",
      material: { kind: "pdf", file: new File([new Uint8Array([37, 80, 68, 70])], "paper.pdf", { type: "application/pdf" }) as unknown as globalThis.File, pdfEngine: "mistral-ocr" },
      contributions: "",
      block,
      previousQuestions: [],
      modelId: "claude",
    }).catch(() => undefined);
    const headers = new Headers(seen[0].init?.headers);
    expect(seen[0].url).toBe(`${CMU}/chat/completions`);
    expect(headers.get("authorization")).toBe("Bearer sk-cmu");
    expect(headers.has("x-title")).toBe(false);
    const body = JSON.parse(String(seen[0].init?.body)) as { plugins?: unknown; messages: Array<{ content: Array<{ type: string }> }> };
    expect(body.plugins).toBeUndefined();
    expect(body.messages[0].content.some((part) => part.type === "file")).toBe(true);
  });
});

describe("stored keys and tests per endpoint", () => {
  it("stores one key per endpoint, and generates and records a test on the instructor's institution", async () => {
    const instructor = await registerAccount({ username: "instructor-a", password: "long password for endpoints" });
    const expires = new Date(Date.now() + 30 * DAY).toISOString();
    stub({
      "https://openrouter.ai/api/v1/key": () =>
        Response.json({ data: { limit: 5, limit_remaining: 5, expires_at: expires, label: "or" } }),
      [`${CMU}/key/info`]: () => Response.json({ error: "forbidden" }, { status: 403 }),
      [`${CMU}/models`]: () => Response.json({ data: [{ id: "claude" }] }),
      [`${CMU}/model/info`]: () =>
        Response.json({ data: [{ model_name: "claude", model_info: { max_input_tokens: 200000, mode: "chat" } }] }),
      [`${CMU}/chat/completions`]: chat({
        questions: [{
          prompt: "Why does it clamp?",
          description: "Probes the guard.",
          path: "src/a.py",
          startLine: 1,
          endLine: 1,
          rubric: { summary: "Explains it.", criteria: [{ criterion: "Guard", points: 100, guidance: "Any valid reason." }] },
        }],
      }),
    });

    await saveOpenRouterCredential(instructor.id, "sk-or-instructor");
    // No budget or expiry reported: an institution key is stored all the same.
    await saveOpenRouterCredential(instructor.id, "sk-cmu-instructor", "cmu");
    expect(await credentialStatus(instructor.id, "cmu")).toMatchObject({ connected: true, spendingLimit: null, expiresAt: null });
    expect(await credentialStatus(instructor.id)).toMatchObject({ connected: true, spendingLimit: 5 });
    expect(await requireOpenRouterCredential(instructor.id, "cmu")).toBe("sk-cmu-instructor");
    expect(await requireOpenRouterCredential(instructor.id)).toBe("sk-or-instructor");
    const rows = await db.select().from(openRouterCredentials).where(eq(openRouterCredentials.userId, instructor.id));
    expect(rows.map((row) => row.endpoint).sort()).toEqual(["cmu", "openrouter"]);
    expect(JSON.stringify(rows)).not.toContain("sk-cmu-instructor");

    const bundle = bundleFromZip(zipSync({ "src/a.py": strToU8("x = max(0, y)\n") }), "a.zip");
    seen = [];
    const queued = await enqueueGenerationJob(
      instructor.id,
      new File([serializeBundle(bundle)], bundle.name, { type: "application/json" }),
      {
        materialKind: "code",
        endpoint: "cmu",
        setName: "On CMU",
        apiKeyPayer: "creator",
        materialUploader: "creator",
        credentialOwnerUserId: instructor.id,
        contributions: "",
        modelId: "claude",
        pdfEngine: "native",
        randomize: false,
        overallTimeLimitSeconds: null,
        blocks: [block],
      },
    );
    let job = await getOwnedJob(queued.jobId, instructor.id);
    for (let index = 0; index < 300 && job.status !== "completed" && job.status !== "failed"; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      job = await getOwnedJob(queued.jobId, instructor.id);
    }
    expect(job.error ?? null).toBeNull();
    const setId = (job.result as { questionSetId: string }).questionSetId;
    const set = await db.select().from(questionSets).where(eq(questionSets.id, setId)).get();
    expect(set?.endpoint).toBe("cmu");
    // Every request went to CMU, with the instructor's CMU key.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((entry) => entry.url.startsWith(CMU) && auth(entry) === "Bearer sk-cmu-instructor")).toBe(true);
  });

  it("refuses taker-paid templates and other groups' endpoints", async () => {
    const instructor = await registerAccount({ username: "instructor-b", password: "long password for endpoints" });
    const student = await registerAccount({ username: "a-student", password: "long password for endpoints" });
    const templateConfig = { modelId: "claude", endpoint: "cmu", pdfEngine: "native" as const, blocks: [], randomize: false, overallTimeLimitSeconds: null };
    await expect(
      saveTemplate(instructor.id, "Paid by takers", templateConfig, "taker", "taker"),
    ).rejects.toThrow(/paid for by their creator/);
    await expect(
      saveTemplate(student.id, "Not my group", templateConfig, "creator", "creator"),
    ).rejects.toThrow(/no longer set up/);

    sessionState.token = await createAccountSession(student.id);
    expect(await (await listEndpoints()).json()).toEqual({ endpoints: [{ id: "openrouter", label: "OpenRouter" }] });
    sessionState.token = await createAccountSession(instructor.id);
    const listed = await (await listEndpoints()).json();
    expect(listed.endpoints[1]).toEqual({ id: "cmu", label: "CMU" });
    expect(JSON.stringify(listed)).not.toContain("example.edu");
  });
});
