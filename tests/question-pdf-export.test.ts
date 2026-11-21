import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: "",
  renderQuestionPdfs: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "rc_session" && mocks.token ? { value: mocks.token } : undefined,
  }),
}));
vi.mock("@/lib/question-pdf-renderer", () => ({ renderQuestionPdfs: mocks.renderQuestionPdfs }));

import { POST } from "@/app/api/export/questions/route";
import QuestionSetPrintPage from "@/app/question-sets/[id]/print/page";
import { db } from "@/db";
import { questionSets, users } from "@/db/schema";
import { createAccountSession, registerAccount } from "@/lib/accounts";
import { questionPdfFilenames } from "@/lib/question-pdf-filenames";

describe("question PDF export", () => {
  let adminToken: string;
  let unverifiedToken: string;

  beforeAll(async () => {
    const owner = await registerAccount({ username: "pdf-owner", password: "some pdf password" });
    const other = await registerAccount({ username: "pdf-other", password: "some pdf password" });
    db.update(users).set({ verifiedEmail: "pdf-owner@example.com", mfaSecret: "test-factor" })
      .where(eq(users.id, owner.id)).run();
    adminToken = await createAccountSession(owner.id, { mfaVerified: true });
    unverifiedToken = await createAccountSession(owner.id);
    const fixture = {
      name: "Batch - test",
      contributions: "",
      modelId: "test",
      pdfEngine: "test",
      configJson: "{}",
      questionsJson: JSON.stringify([{
        id: "q1",
        type: "multiple_choice",
        prompt: "Example",
        options: [{ id: "a", label: "First option" }],
        correctOptionId: "a",
        rationale: "The first option is correct.",
      }]),
      createdAt: new Date().toISOString(),
    };
    db.insert(questionSets).values([
      { ...fixture, id: "own-1", ownerUserId: owner.id, paperName: "Étude.v2.PDF" },
      { ...fixture, id: "own-2", ownerUserId: owner.id, paperName: "Étude.v2.pdf" },
      { ...fixture, id: "other", ownerUserId: other.id, paperName: "Other.pdf" },
    ]).run();
  });

  beforeEach(() => {
    mocks.token = adminToken;
    mocks.renderQuestionPdfs.mockReset();
    mocks.renderQuestionPdfs.mockImplementation(async (ids: string[]) =>
      ids.map((id) => new TextEncoder().encode("%PDF- " + id)),
    );
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/export/questions", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost" },
      body: JSON.stringify(body),
    });
  }

  it("deduplicates IDs and exports a named student PDF per set", async () => {
    const response = await POST(request({ format: "zip", ids: ["own-1", "own-1", "own-2"] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(["Étude.v2_questions.pdf", "Étude.v2 (2)_questions.pdf"]);
    expect(new TextDecoder().decode(entries["Étude.v2 (2)_questions.pdf"])).toBe("%PDF- own-2");
    expect(mocks.renderQuestionPdfs).toHaveBeenCalledWith(
      ["own-1", "own-2"], false, "rc_session=" + adminToken, expect.any(AbortSignal),
    );
  });

  it("uses the source filename for an individual answer key", async () => {
    const response = await POST(request({ format: "pdf", ids: ["own-1"], withKey: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("%C3%89tude.v2_answer_key.pdf");
    expect(mocks.renderQuestionPdfs).toHaveBeenCalledWith(
      ["own-1"], true, "rc_session=" + adminToken, expect.any(AbortSignal),
    );
  });

  it("prints the source filename stem as the title on student and keyed copies", async () => {
    for (const key of [undefined, "1"]) {
      const page = await QuestionSetPrintPage({
        params: Promise.resolve({ id: "own-1" }),
        searchParams: Promise.resolve({ key }),
      });
      const html = renderToStaticMarkup(page);
      expect(html).toContain("<h1>Étude.v2</h1>");
      expect(html).not.toContain("Batch - test");
    }
  });

  it("rejects non-administrators and mixed-ownership exports before rendering", async () => {
    mocks.token = unverifiedToken;
    const selection = { format: "zip", ids: ["own-1", "other"] };
    expect((await POST(request(selection))).status).toBe(403);
    mocks.token = adminToken;
    expect((await POST(request(selection))).status).toBe(404);
    expect(mocks.renderQuestionPdfs).not.toHaveBeenCalled();
  });

  it("returns an error instead of a partial archive when rendering fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.renderQuestionPdfs.mockRejectedValueOnce(new Error("Internal renderer error"));
      const response = await POST(request({ format: "zip", ids: ["own-1", "own-2"] }));
      expect(response.status).toBe(500);
      expect(response.headers.has("content-disposition")).toBe(false);
      await expect(response.json()).resolves.toEqual({ error: "Unable to prepare the question PDFs." });
    } finally {
      log.mockRestore();
    }
  });

  it("sanitizes unsafe characters and preserves non-PDF source extensions", () => {
    expect(questionPdfFilenames([
      { materialKind: "pdf", paperName: "My study?.pdf" },
      { materialKind: "code", paperName: "owner/project.zip" },
    ], false)).toEqual(["My study__questions.pdf", "owner_project.zip_questions.pdf"]);
  });
});
