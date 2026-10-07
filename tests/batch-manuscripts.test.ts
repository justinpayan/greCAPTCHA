import { describe, expect, it } from "vitest";

import {
  batchTestNames,
  manuscriptLabel,
  MAX_BATCH_MANUSCRIPTS,
  readBatchManuscripts,
} from "@/lib/batch-manuscripts";
import { MAX_PDF_BYTES } from "@/lib/uploads";

function pdf(name: string, bytes = 10) {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

describe("batch manuscripts", () => {
  it("reads every picked PDF", () => {
    const form = new FormData();
    form.append("paper", pdf("first.pdf"));
    form.append("paper", pdf("second.PDF"));
    expect(readBatchManuscripts(form).map((item) => item.label)).toEqual(["first", "second"]);
  });

  it("reads one link per line, skipping blanks and repeats", () => {
    const form = new FormData();
    form.set(
      "paperUrls",
      "https://arxiv.org/pdf/2609.20481\n\n  https://example.org/a/paper%20two.pdf \nhttps://arxiv.org/pdf/2609.20481",
    );
    expect(readBatchManuscripts(form)).toEqual([
      { kind: "link", label: "2609.20481", url: "https://arxiv.org/pdf/2609.20481" },
      { kind: "link", label: "paper two", url: "https://example.org/a/paper%20two.pdf" },
    ]);
  });

  it("refuses an empty batch, an oversized one, and an oversized or non-PDF file", () => {
    expect(() => readBatchManuscripts(new FormData())).toThrow(/at least one/);

    const many = new FormData();
    many.set(
      "paperUrls",
      Array.from({ length: MAX_BATCH_MANUSCRIPTS + 1 }, (_, i) => `https://x.org/${i}.pdf`).join("\n"),
    );
    expect(() => readBatchManuscripts(many)).toThrow(/at most/);

    const big = new FormData();
    big.append("paper", pdf("big.pdf", MAX_PDF_BYTES + 1));
    expect(() => readBatchManuscripts(big)).toThrow(/big\.pdf/);

    const text = new FormData();
    text.append("paper", new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(() => readBatchManuscripts(text)).toThrow(/not a PDF/);
  });

  it("names each test after the shared name and its manuscript, numbering repeats", () => {
    const items = ["a.pdf", "b.pdf", "a.pdf"].map((name) => ({
      kind: "file" as const,
      label: manuscriptLabel({ file: pdf(name) }),
      file: pdf(name),
    }));
    expect(batchTestNames("Week 3", items)).toEqual(["Week 3 — a", "Week 3 — b", "Week 3 — a (2)"]);
    expect(batchTestNames("  ", items)).toEqual(["a", "b", "a (2)"]);
  });
});
