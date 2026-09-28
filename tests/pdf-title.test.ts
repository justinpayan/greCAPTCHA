import { describe, expect, it } from "vitest";

import { extractPdfTitle, usableTitle } from "@/lib/pdf-title";

/** A minimal, valid PDF whose Info dictionary carries `title` (or none). */
function pdfWithTitle(title?: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    title === undefined ? "<< >>" : `<< /Title (${title}) >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\n`;
  body += `startxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("PDF titles", () => {
  it("reads the title a PDF declares", async () => {
    expect(await extractPdfTitle(pdfWithTitle("Capacity to Verify in Practice"))).toBe(
      "Capacity to Verify in Practice",
    );
  });

  it("falls back (null) when there is no usable title", async () => {
    expect(await extractPdfTitle(pdfWithTitle())).toBeNull();
    expect(await extractPdfTitle(pdfWithTitle("Microsoft Word - draft3.docx"))).toBeNull();
    expect(await extractPdfTitle(new TextEncoder().encode("not a pdf"))).toBeNull();
  });

  it("ignores placeholder titles", () => {
    for (const raw of ["", "  ", "untitled", "Untitled", "paper.pdf", "main.tex", "1234", null]) {
      expect(usableTitle(raw), String(raw)).toBeNull();
    }
    expect(usableTitle("  greCAPTCHA:\n Assessing   Understanding ")).toBe(
      "greCAPTCHA: Assessing Understanding",
    );
  });
});
