import "server-only";

import { chromium } from "playwright-core";

export async function renderQuestionPdfs(
  ids: string[],
  withKey: boolean,
  sessionCookie: string,
  signal: AbortSignal,
): Promise<Uint8Array[]> {
  signal.throwIfAborted();
  const origin = "http://127.0.0.1:" + (process.env.PORT || "3000");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  const cancel = () => void browser.close().catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    let printUrl = "";
    let printDocument = "";
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest() && url.href === printUrl) {
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: printDocument });
      } else if (
        url.origin === origin &&
        url.pathname.startsWith("/_next/static/") &&
        ["stylesheet", "font"].includes(request.resourceType())
      ) {
        await route.continue();
      } else {
        await route.abort();
      }
    });

    const pdfs: Uint8Array[] = [];
    for (const id of ids) {
      signal.throwIfAborted();
      printUrl = origin + "/question-sets/" + encodeURIComponent(id) + "/print";
      if (withKey) printUrl += "?key=1";
      // Keep credentials server-side and send them only to the exact loopback print view.
      const response = await fetch(printUrl, {
        headers: { cookie: sessionCookie },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new Error("Could not load the question-set print view.");
      printDocument = await response.text();
      await page.goto(printUrl, { waitUntil: "load" });
      await page.locator(".print-sheet .print-question").first().waitFor({ state: "visible" });
      pdfs.push(
        await page.pdf({ format: "Letter", displayHeaderFooter: false, printBackground: true }),
      );
    }
    return pdfs;
  } finally {
    signal.removeEventListener("abort", cancel);
    await browser.close();
  }
}
