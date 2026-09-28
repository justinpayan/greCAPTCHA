import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  loadManuscript,
  ManuscriptTooLargeError,
  readManuscriptSource,
} from "@/lib/manuscript-input";
import { fetchPdfLink, isPublicAddress, parsePdfLink, PdfLinkError } from "@/lib/pdf-link";
import { MAX_PDF_BYTES } from "@/lib/uploads";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    switch (request.url) {
      case "/paper.pdf":
        response.writeHead(200, { "Content-Type": "application/pdf" });
        return response.end(PDF);
      case "/abs/2609.20481":
        response.writeHead(200, { "Content-Type": "text/html" });
        return response.end("<!doctype html><title>Abstract page</title>");
      case "/pdf/2609.20481":
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        return response.end(PDF);
      case "/redirect":
        response.writeHead(302, { Location: "/pdf/2609.20481" });
        return response.end();
      case "/loop":
        response.writeHead(302, { Location: "/loop" });
        return response.end();
      case "/huge":
        response.writeHead(200, { "Content-Length": String(MAX_PDF_BYTES + 1) });
        return response.end();
      case "/stream-huge":
        // No length header: the cap has to be enforced while the body streams.
        response.writeHead(200);
        response.write(PDF);
        response.end(Buffer.alloc(MAX_PDF_BYTES));
        return;
      default:
        response.writeHead(404);
        return response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// The fixture server is on localhost, which the production policy rightly refuses.
const allowLocal = { isAllowedAddress: () => true };

describe("manuscript links", () => {
  it("accepts only public addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "not-an-ip",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ["8.8.8.8", "151.101.1.140", "2606:4700:4700::1111"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("rejects malformed and non-web links before fetching", () => {
    expect(() => parsePdfLink("not a url")).toThrow(PdfLinkError);
    expect(() => parsePdfLink("ftp://example.org/paper.pdf")).toThrow(/http/);
    expect(() => parsePdfLink("file:///etc/passwd")).toThrow(/http/);
    expect(() => parsePdfLink("https://user:secret@example.org/paper.pdf")).toThrow(/password/);
    expect(parsePdfLink(" https://arxiv.org/pdf/2609.20481 ").hostname).toBe("arxiv.org");
  });

  it("refuses private and loopback hosts by default", async () => {
    await expect(fetchPdfLink(new URL(`${base}/paper.pdf`))).rejects.toThrow(/private or local/);
    await expect(fetchPdfLink(new URL("http://[::1]/paper.pdf"))).rejects.toThrow(/private or local/);
    // A name that resolves to loopback is caught at lookup time, not just literal addresses.
    await expect(fetchPdfLink(new URL("http://localhost/paper.pdf"))).rejects.toThrow(
      /private or local/,
    );
  });

  it("downloads a PDF and names it after the link", async () => {
    const file = await fetchPdfLink(new URL(`${base}/paper.pdf`), allowLocal);
    expect(file.name).toBe("paper.pdf");
    expect(file.type).toBe("application/pdf");
    expect(Buffer.from(await file.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("follows redirects and adds a .pdf extension when the link has none", async () => {
    const file = await fetchPdfLink(new URL(`${base}/redirect`), allowLocal);
    expect(file.name).toBe("2609.20481.pdf");
  });

  it("explains links that do not lead to a usable PDF", async () => {
    await expect(fetchPdfLink(new URL(`${base}/abs/2609.20481`), allowLocal)).rejects.toThrow(
      /did not return a PDF/,
    );
    await expect(fetchPdfLink(new URL(`${base}/missing.pdf`), allowLocal)).rejects.toThrow(
      /HTTP 404/,
    );
    await expect(fetchPdfLink(new URL(`${base}/loop`), allowLocal)).rejects.toThrow(
      /redirected too many times/,
    );
    await expect(fetchPdfLink(new URL(`${base}/huge`), allowLocal)).rejects.toThrow(/larger than/);
    await expect(fetchPdfLink(new URL(`${base}/stream-huge`), allowLocal)).rejects.toThrow(
      /larger than/,
    );
  });

  it("reads either an upload or a link from the form, but not both", async () => {
    const upload = new FormData();
    upload.set("paper", new File([PDF], "paper.pdf", { type: "application/pdf" }));
    const source = readManuscriptSource(upload);
    expect(source.kind).toBe("file");
    expect((await loadManuscript(source)).name).toBe("paper.pdf");

    const linked = new FormData();
    linked.set("paperUrl", "https://arxiv.org/pdf/2609.20481");
    expect(readManuscriptSource(linked)).toMatchObject({ kind: "link" });

    const both = new FormData();
    both.set("paper", new File([PDF], "paper.pdf", { type: "application/pdf" }));
    both.set("paperUrl", "https://arxiv.org/pdf/2609.20481");
    expect(() => readManuscriptSource(both)).toThrow(/not both/);

    expect(() => readManuscriptSource(new FormData())).toThrow(/Choose a PDF/);

    const oversized = new FormData();
    oversized.set(
      "paper",
      new File([Buffer.alloc(MAX_PDF_BYTES + 1)], "big.pdf", { type: "application/pdf" }),
    );
    expect(() => readManuscriptSource(oversized)).toThrow(ManuscriptTooLargeError);

    const fake = new FormData();
    fake.set("paper", new File(["<html>"], "fake.pdf", { type: "application/pdf" }));
    await expect(loadManuscript(readManuscriptSource(fake))).rejects.toThrow(/not a valid PDF/);
  });
});
