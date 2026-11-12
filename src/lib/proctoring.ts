import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { attempts, conferenceSubmissions } from "@/db/schema";
import { submitAttempt } from "@/lib/attempt-submit";
import { proctoringCutoff } from "@/lib/proctoring-clock";

export async function updateProctoring(attemptId: string, action?: "setup" | "continue" | "check-in") {
  const state = db.transaction((tx) => {
    const row = tx.select().from(conferenceSubmissions)
      .where(eq(conferenceSubmissions.attemptId, attemptId)).get();
    const attempt = tx.select().from(attempts).where(eq(attempts.id, attemptId)).get();
    if (!row?.requireSeb || !attempt) throw new Error("Proctored assessment unavailable.");
    const now = Date.now();
    const setupEndsAt = row.setupEndsAt ?? (action === "setup" ? now + 300_000 : null);
    const start = row.examStartedAt ?? (setupEndsAt !== null &&
      (action === "continue" || setupEndsAt <= now) ? Math.min(now, setupEndsAt) : null);
    const last = row.lastCheckInAt ?? start;
    let recoveredOutages = row.recoveredOutages;
    let disqualification = row.disqualification;
    let cutoff: number | null = null;
    if (attempt.status === "active" && start !== null && last !== null) {
      const deadline = start + (attempt.overallTimeLimitSeconds ?? 0) * 1000;
      const clock = proctoringCutoff(now, deadline, last, recoveredOutages, action === "check-in");
      cutoff = clock.cutoff;
      disqualification ??= clock.disqualification;
      if (clock.recovered) recoveredOutages += 1;
    }
    tx.update(conferenceSubmissions).set({
      setupEndsAt,
      examStartedAt: start,
      lastCheckInAt: action === "check-in" && cutoff === null && start !== null ? now : last,
      recoveredOutages,
      disqualification,
    }).where(eq(conferenceSubmissions.id, row.id)).run();
    return {
      started: start !== null,
      setupEndsAt,
      closed: attempt.status !== "active" || cutoff !== null,
      cutoff,
      disqualification,
    };
  }, { behavior: "immediate" });
  if (state.cutoff !== null) await submitAttempt(attemptId, "timeout", state.cutoff);
  return state;
}

export function startProctoringWorker() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const rows = db.select({ id: attempts.id }).from(attempts)
        .innerJoin(conferenceSubmissions, eq(conferenceSubmissions.attemptId, attempts.id))
        .where(and(eq(attempts.status, "active"), eq(conferenceSubmissions.requireSeb, true),
          isNotNull(conferenceSubmissions.setupEndsAt))).all();
      for (const row of rows) await updateProctoring(row.id);
    } catch (error) {
      console.error("Unable to reconcile proctored assessments", error);
    } finally {
      running = false;
    }
  }, 1000);
  timer.unref();
}
