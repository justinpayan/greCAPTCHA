import { expect, it } from "vitest";

const baseUrl = (process.env.DEPLOYED_BASE_URL ?? "").replace(/\/+$/, "");
const deployed = process.env.RUN_DEPLOYED_SMOKE_TEST === "1" && baseUrl ? it : it.skip;

function realFetch() {
  const fetcher = (globalThis as typeof globalThis & { __realFetch?: typeof fetch }).__realFetch;
  if (!fetcher) throw new Error("Native fetch is unavailable.");
  return fetcher;
}

deployed("serves course and conference workflows with authentication boundaries", async () => {
  const fetcher = realFetch();
  const health = await fetcher(`${baseUrl}/api/health`, { cache: "no-store" });
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ok: true });

  const root = await fetcher(`${baseUrl}/`, { redirect: "manual" });
  expect([301, 302, 303, 307, 308]).toContain(root.status);
  expect(new URL(root.headers.get("location") ?? "", baseUrl).pathname).toBe("/login");

  const login = await fetcher(`${baseUrl}/login`, { cache: "no-store" });
  expect(login.status).toBe(200);
  const loginHtml = await login.text();
  expect(loginHtml).toContain("Welcome back");
  expect(loginHtml).not.toContain("OpenRouter API key (optional)");
  expect(login.headers.get("x-content-type-options")).toBe("nosniff");
  expect(login.headers.get("x-frame-options")).toBe("DENY");
  expect(login.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

  for (const path of [
    "/api/question-sets",
    "/api/created-tests",
    "/api/templates",
    "/api/export/answers",
    "/api/openrouter/credential",
    "/api/openrouter/models",
    "/api/conference/not-a-real-token",
    "/api/attempts/not-a-real-attempt/grade",
    "/api/attempts/not-a-real-attempt/feedback",
  ]) {
    const protectedApi = await fetcher(`${baseUrl}${path}`, {
      cache: "no-store",
      redirect: "manual",
    });
    expect(protectedApi.status, path).toBe(401);
    expect(await protectedApi.json(), path).toMatchObject({ error: "Not authorised." });
  }

  for (const path of ["/take/not-a-real-token", "/conference/not-a-real-token"]) {
    const protectedPage = await fetcher(`${baseUrl}${path}`, { redirect: "manual" });
    expect([301, 302, 303, 307, 308], path).toContain(protectedPage.status);
    const location = new URL(protectedPage.headers.get("location") ?? "", baseUrl);
    expect(location.pathname, path).toBe("/login");
    expect(location.searchParams.get("next"), path).toBe(path);
  }
});
