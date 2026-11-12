import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { attemptFeedback, attempts, conferenceSubmissions } from "@/db/schema";
import { enqueueGradingJob } from "@/lib/jobs";
import { validateOpenRouterKey } from "@/lib/openrouter";
import { requireConferenceCredential, saveConferenceCredential } from "@/lib/openrouter-credentials";
import { updateProctoring } from "@/lib/proctoring";
import { assertSameOrigin, enforceRateLimit } from "@/lib/security";
import {
  hashSecret, newSebSecret, proctoredAttempt, SEB_QUIT_PATH, sebOrigin, verifiedSebSession,
} from "@/lib/seb";
import { currentUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

// The regular browser observes completion without receiving any SEB session secrets.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await context.params;
  const row = proctoredAttempt(id);
  if (!row || row.takerUserId !== user.id) return new Response(null, { status: 404 });
  return NextResponse.json({ finished: row.sebFinishedAt !== null }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const row = proctoredAttempt(id);
    if (!row) return new Response(null, { status: 404 });
    const body = await request.json();
    const { action } = body;
    if (action === "launch" || action === "connect") {
      const user = await currentUser();
      if (user?.id !== row.takerUserId) return new Response(null, { status: 403 });
      await enforceRateLimit(request, "seb-setup", user.id, 30, 600);
      const attempt = db.select().from(attempts).where(eq(attempts.id, id)).get();
      if (!attempt || attempt.takerUserId !== user.id) return new Response(null, { status: 403 });
      if (action === "connect") {
        if (row.apiKeyPayer !== "taker" || attempt.status === "graded") return new Response(null, { status: 409 });
        await saveConferenceCredential(row.id, String(body.key ?? ""));
        if (attempt.status === "submitted") {
          await enqueueGradingJob(id, { conferenceCredentialId: row.id });
        }
        return NextResponse.json({ connected: true });
      }
      if (attempt.status === "active" && body.checklist !== true) {
        throw new Error("Confirm the recording checklist before launch.");
      }
      const configUrl = new URL(process.env.SEB_CONFIG_URL ?? "", sebOrigin());
      if (!process.env.SEB_CONFIG_URL || configUrl.origin !== sebOrigin() ||
          !configUrl.pathname.endsWith(".seb") || configUrl.search || configUrl.hash ||
          !process.env.SEB_BROWSER_EXAM_KEYS?.split(",").some((key) => /^[a-f0-9]{64}$/i.test(key.trim()))) {
        throw new Error("Safe Exam Browser has not been configured for this conference.");
      }
      if (row.apiKeyPayer === "taker" && attempt.status === "active" && row.examStartedAt === null) {
        await validateOpenRouterKey(requireConferenceCredential(row.id), { requireSafeguards: true });
      }
      const token = newSebSecret();
      db.update(conferenceSubmissions).set({
        launchHash: hashSecret(token),
        launchExpiresAt: Date.now() + 600_000,
        sebFinishedAt: null,
      }).where(eq(conferenceSubmissions.id, row.id)).run();
      // SEB uses ?? to forward parameters to the Start URL when the config URL
      // has no query. A single ? can leave the token on the config download.
      const link = configUrl.href.replace(/^https:/, "sebs:") + "??launch=" + encodeURIComponent(token);
      return NextResponse.json({ link, download: configUrl.href, code: token }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (!await verifiedSebSession(id, request)) return new Response(null, { status: 403 });
    if (action === "quit") {
      const state = await updateProctoring(id);
      if (!state.closed) return new Response(null, { status: 409 });
      const attempt = db.select({ status: attempts.status }).from(attempts).where(eq(attempts.id, id)).get();
      if (attempt?.status !== "graded" || !db.select().from(attemptFeedback).where(eq(attemptFeedback.attemptId, id)).get()) {
        return new Response(null, { status: 409 });
      }
      db.update(conferenceSubmissions).set({ sebFinishedAt: Date.now() })
        .where(eq(conferenceSubmissions.id, row.id)).run();
      const response = NextResponse.json({ quitUrl: sebOrigin() + SEB_QUIT_PATH });
      return response;
    }
    if (action !== "setup" && action !== "continue" && action !== "check-in") {
      return new Response(null, { status: 400 });
    }
    return NextResponse.json(await updateProctoring(id, action));
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Unable to complete assessment setup.") }, { status: 400 });
  }
}
