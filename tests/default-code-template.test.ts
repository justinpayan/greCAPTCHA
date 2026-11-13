import { describe, expect, it } from "vitest";

import { readBatchManuscripts, repositoryLabel } from "@/lib/batch-manuscripts";
import { generationCost, gradingCost } from "@/lib/cost-estimate";
import {
  createDefaultCodeBlocks,
  DEFAULT_CODE_GRADING_INSTRUCTIONS,
} from "@/lib/default-code-template";
import { activeFixedRubric, fixedRubricProblems, generationConfigSchema } from "@/lib/quiz";
import { MAX_ZIP_BYTES } from "@/lib/uploads";

describe("default code template", () => {
  const blocks = createDefaultCodeBlocks();

  it("has the five agreed families, with no warm-up", () => {
    expect(blocks.map((block) => [block.name, block.type])).toEqual([
      ["Execution tracing", "multiple_choice"],
      ["Flow reconstruction", "fill_blank"],
      ["Change impact", "free_response"],
      ["Unstated design rationale", "free_response"],
      ["Failure conditions", "free_response"],
    ]);
    expect(blocks.some((block) => block.warmup)).toBe(false);
    expect(blocks.reduce((sum, block) => sum + block.count, 0)).toBe(10);
  });

  it("is ready to generate: every fixed rubric is complete", () => {
    expect(generationConfigSchema.safeParse(blocks).success).toBe(true);
    for (const block of blocks) {
      const rubric = activeFixedRubric(block);
      if (rubric) expect(fixedRubricProblems(rubric)).toEqual([]);
    }
  });

  it("weights every free-response rubric 30 / 50 / 20, the middle criterion on this code", () => {
    for (const block of blocks.filter((one) => one.type === "free_response")) {
      const rubric = activeFixedRubric(block)!;
      expect(rubric.criteria.map((criterion) => criterion.points)).toEqual([30, 50, 20]);
      expect(rubric.criteria[1].criterion).toMatch(/this code/i);
    }
  });

  it("voids a failure condition the repository already flags", () => {
    const failure = activeFixedRubric(blocks.find((block) => block.name === "Failure conditions")!)!;
    expect(failure.gradingNote).toMatch(/already flags.*scores 0/);
  });

  it("grades against the code, crediting what is true of it", () => {
    expect(DEFAULT_CODE_GRADING_INSTRUCTIONS).toMatch(/Check against the code/);
    expect(DEFAULT_CODE_GRADING_INSTRUCTIONS).toMatch(/general programming knowledge/);
  });
});

describe("code cost estimates", () => {
  const price = { promptPerToken: 1e-6, completionPerToken: 1e-5 };
  const families = [{ count: 2, candidatePoolSize: 6 }];

  it("prices a codebase by its tokens, with no extraction fee", () => {
    const small = generationCost({ price, blocks: families, pages: 0, pdfEngine: "mistral-ocr", codeTokens: 10_000 });
    const large = generationCost({ price, blocks: families, pages: 0, pdfEngine: "mistral-ocr", codeTokens: 110_000 });
    // 100k more input tokens on the one request, at $1 a million; the low end counts 75% of them.
    expect(large.high - small.high).toBeCloseTo(0.1, 6);
    expect(large.low - small.low).toBeCloseTo(0.075, 6);
    const grading = gradingCost({ price, freeResponseBlocks: [2], codeTokens: 10_000, pdfEngine: "mistral-ocr" });
    const pdfGrading = gradingCost({ price, freeResponseBlocks: [2], pages: 0, pdfEngine: "mistral-ocr" });
    expect(grading.high - pdfGrading.high).toBeCloseTo(0.01, 6);
  });
});

describe("codebase batches", () => {
  it("names repositories by owner and repository, or group and project", () => {
    expect(repositoryLabel("https://github.com/course/team-1/tree/main")).toBe("course/team-1");
    expect(repositoryLabel("https://gitlab.com/school/course/team-2/-/tree/dev")).toBe("course/team-2");
    expect(repositoryLabel("https://github.com/course/team-3.git")).toBe("course/team-3");
  });

  it("reads several ZIPs, or one repository per line", () => {
    const zips = new FormData();
    zips.append("codebase", new File(["PK"], "team-1.zip"));
    zips.append("codebase", new File(["PK"], "team-2.zip"));
    expect(readBatchManuscripts(zips).map((item) => [item.kind, item.label])).toEqual([
      ["zip", "team-1"],
      ["zip", "team-2"],
    ]);
    const links = new FormData();
    links.set("repoUrls", "https://github.com/c/a\n\nhttps://github.com/c/b\nhttps://github.com/c/a");
    expect(readBatchManuscripts(links).map((item) => item.label)).toEqual(["c/a", "c/b"]);
  });

  it("refuses files that are not ZIPs and oversized ones, naming them", () => {
    const wrong = new FormData();
    wrong.append("codebase", new File(["x"], "notes.pdf"));
    expect(() => readBatchManuscripts(wrong)).toThrow(/“notes.pdf” is not a ZIP/);
    const big = new FormData();
    big.append("codebase", new File([new Uint8Array(MAX_ZIP_BYTES + 1)], "big.zip"));
    expect(() => readBatchManuscripts(big)).toThrow(/“big.zip”/);
  });
});
