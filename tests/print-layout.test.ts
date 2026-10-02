import { describe, expect, it } from "vitest";

import { paginateForPrint } from "@/lib/print-layout";

const q = (id: string, type: string) => ({ id, type });

describe("print pagination", () => {
  it("flows multiple choice, gives each fill-in-the-blank a page, and pairs free responses", () => {
    const pages = paginateForPrint([
      q("mc1", "multiple_choice"),
      q("mc2", "multiple_choice"),
      q("mc3", "multiple_choice"),
      q("fill1", "fill_blank"),
      q("fill2", "fill_blank"),
      q("free1", "free_response"),
      q("free2", "free_response"),
      q("free3", "free_response"),
    ]);
    expect(pages.map((page) => [page.kind, page.items.map((item) => item.id)])).toEqual([
      ["flow", ["mc1", "mc2", "mc3"]],
      ["paired", ["fill1"]],
      ["paired", ["fill2"]],
      ["paired", ["free1", "free2"]],
      ["paired", ["free3"]],
    ]);
  });

  it("never exceeds a type's limit or mixes types on one page", () => {
    const pages = paginateForPrint([
      q("free1", "free_response"),
      q("fill1", "fill_blank"),
      q("free2", "free_response"),
      q("mc1", "multiple_choice"),
      q("free3", "free_response"),
      q("free4", "free_response"),
      q("free5", "free_response"),
    ]);
    expect(pages.map((page) => page.items.map((item) => item.id))).toEqual([
      ["free1"],
      ["fill1"],
      ["free2"],
      ["mc1"],
      ["free3", "free4"],
      ["free5"],
    ]);
    for (const page of pages) {
      expect(new Set(page.items.map((item) => item.type)).size).toBe(1);
      if (page.type === "fill_blank") expect(page.items).toHaveLength(1);
      if (page.type === "free_response") expect(page.items.length).toBeLessThanOrEqual(2);
    }
  });
});
