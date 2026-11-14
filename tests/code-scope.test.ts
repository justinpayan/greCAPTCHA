import { afterEach, describe, expect, it, vi } from "vitest";

import { type CodeBundle, describeCodeScope, parseBundle, serializeBundle } from "@/lib/code-bundle";
import { applyCodeScope, codebaseListing, readCodebaseSource } from "@/lib/codebase-input";
import { generateQuestionBlock } from "@/lib/openrouter";
import { questionBlockSchema } from "@/lib/quiz";

const code: CodeBundle = {
  version: 1,
  name: "demo",
  source: { kind: "zip" },
  files: [
    { path: "src/app.py", text: "def main():\n    return compute(2)\n" },
    { path: "src/compute.py", text: "def compute(x):\n    return x * 3\n\ndef unused():\n    pass\n" },
    { path: "tests/test_app.py", text: "def test_main():\n    assert main() == 6\n" },
  ],
  skipped: [],
  redactions: 0,
};

function scopeForm(scope: unknown): FormData {
  const form = new FormData();
  form.set("codeScope", typeof scope === "string" ? scope : JSON.stringify(scope));
  return form;
}

describe("declared code scope", () => {
  it("lists the files with their line counts for the picker", () => {
    expect(codebaseListing(code).files).toEqual([
      { path: "src/app.py", lines: 2 },
      { path: "src/compute.py", lines: 5 },
      { path: "tests/test_app.py", lines: 2 },
    ]);
  });

  it("applies picked files to the bundle and describes them as the contribution statement", () => {
    const scoped = applyCodeScope(
      code,
      scopeForm([
        { path: "src/compute.py", detail: " compute()\nnot unused() " },
        { path: "src/app.py", detail: "" },
      ]),
    )!;
    expect(scoped.bundle.scope).toEqual([
      { path: "src/app.py", detail: "" },
      { path: "src/compute.py", detail: "compute()\nnot unused()" },
    ]);
    // The whole repository stays in the bundle as context.
    expect(scoped.bundle.files).toHaveLength(3);
    expect(scoped.contributions).toBe("src/app.py (whole file)\nsrc/compute.py: compute(); not unused()");
    expect(parseBundle(serializeBundle(scoped.bundle)).scope).toEqual(scoped.bundle.scope);
  });

  it("leaves the whole codebase in scope when nothing was picked", () => {
    expect(applyCodeScope(code, new FormData())).toBeNull();
    expect(applyCodeScope(code, scopeForm([]))).toBeNull();
  });

  it("refuses a picked file the codebase does not have", () => {
    expect(() => applyCodeScope(code, scopeForm([{ path: "src/other.py" }]))).toThrow(
      "“src/other.py” is not among this codebase's files",
    );
    expect(() => applyCodeScope(code, scopeForm("not json"))).toThrow("could not be read");
  });

  it("pins a repository link to the commit its files were listed from", () => {
    const form = new FormData();
    form.set("repoUrl", "https://github.com/owner/repo/tree/main");
    form.set("repoCommit", "a".repeat(40));
    const source = readCodebaseSource(form);
    expect(source.kind === "link" && source.link.ref).toBe("a".repeat(40));
    form.set("repoCommit", "main; rm -rf");
    expect(() => readCodebaseSource(form)).toThrow("commit could not be read");
  });

  it("describes an empty scope as nothing", () => {
    expect(describeCodeScope([])).toBe("");
  });
});

describe("generation from a declared scope", () => {
  afterEach(() => vi.unstubAllGlobals());

  const block = questionBlockSchema.parse({
    id: "mc",
    type: "multiple_choice",
    name: "Execution tracing",
    count: 1,
    candidatePoolSize: 3,
    optionsPerQuestion: 2,
    prompt: "Generate execution-tracing items.",
  });
  const scoped: CodeBundle = { ...code, scope: [{ path: "src/compute.py", detail: "compute()" }] };

  function stubModel(paths: string[]) {
    let prompt = "";
    let codeText = "";
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: Array<{ text?: string }> }> };
      codeText = body.messages[0].content[0].text ?? "";
      prompt = body.messages[0].content[1].text ?? "";
      const questions = paths.map((path, index) => ({
        prompt: `Question ${index}?`,
        description: "Traces code.",
        path,
        startLine: 1,
        endLine: 2,
        answer: "6",
        distractors: ["2"],
        rationale: "Because.",
      }));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ questions }) } }] });
    });
    return () => ({ prompt, codeText });
  }

  it("sends the whole codebase, scopes the prompt, and drops candidates outside the declared files", async () => {
    const sent = stubModel(["src/compute.py", "src/app.py", "src/compute.py"]);
    const result = await generateQuestionBlock({
      apiKey: "sk-or-test",
      material: { kind: "code", bundle: scoped },
      contributions: "src/compute.py: compute()",
      block,
      previousQuestions: [],
      modelId: "test/model",
    });
    expect(sent().codeText).toContain('<file path="src/app.py"');
    expect(sent().codeText).toContain('<file path="tests/test_app.py"');
    expect(sent().prompt).toContain("- src/compute.py: compute()");
    expect(sent().prompt).toContain('Every question\'s "path" must be one of the files listed above');
    const kept = (result.generated as { questions: Array<{ path?: string }> }).questions;
    expect(kept.map((question) => question.path)).toEqual(["src/compute.py", "src/compute.py"]);
  });

  it("fails rather than serve a short block when too few candidates are in scope", async () => {
    stubModel(["src/app.py", "tests/test_app.py", "src/nowhere.py"]);
    await expect(
      generateQuestionBlock({
        apiKey: "sk-or-test",
        material: { kind: "code", bundle: scoped },
        contributions: "src/compute.py: compute()",
        block,
        previousQuestions: [],
        modelId: "test/model",
      }),
    ).rejects.toThrow("outside the files declared");
  });
});
