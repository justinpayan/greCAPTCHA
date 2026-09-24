import "server-only";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lt } from "drizzle-orm";

import { db, databaseFile } from "@/db";
import { attempts, conferenceSubmissions, jobs, questionSets } from "@/db/schema";
import { executeGeneration, type GenerationJobPayload } from "@/lib/generation";
import { deleteManuscript } from "@/lib/manuscripts";
import {
  deleteJobKey,
  JobKeyUnavailableError,
  registerJobKey,
  requireJobKey,
} from "@/lib/openrouter-key-store";
import { requireOpenRouterCredential } from "@/lib/openrouter-credentials";
import type { AssessmentResult } from "@/lib/quiz";

const ACTIVE_STATUSES = ["queued", "running"];
const MAX_RUNS = 3;
const LEASE_MS = 30 * 60 * 1000;
let running = 0;
let ticking = false;
let workerStarted = false;

function concurrency() {
  const parsed = Number(process.env.JOB_CONCURRENCY ?? "2");
  return Number.isInteger(parsed) ? Math.min(4, Math.max(1, parsed)) : 2;
}

function uploadRoot() {
  return path.join(path.dirname(databaseFile), "job-uploads");
}

export async function enqueueGenerationJob(
  ownerUserId: string,
  file: { name: string; arrayBuffer(): Promise<ArrayBuffer> },
  input: Omit<GenerationJobPayload, "questionSetId" | "filePath" | "fileName">,
  apiKey: string,
) {
  const questionSetOwnerUserId = input.questionSetOwnerUserId ?? ownerUserId;
  const setLimit = Math.max(1, Number(process.env.MAX_SETS_PER_ACCOUNT ?? "100"));
  const existingSets = await db
    .select({ total: count() })
    .from(questionSets)
    .where(eq(questionSets.ownerUserId, questionSetOwnerUserId))
    .get();
  if ((existingSets?.total ?? 0) >= setLimit) {
    throw new Error(`Your account has reached its limit of ${setLimit} saved sets.`);
  }
  const active = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.ownerUserId, ownerUserId),
        eq(jobs.type, "generation"),
        inArray(jobs.status, ACTIVE_STATUSES),
      ),
    )
    .get();
  if (active) throw new Error("You already have a question set being generated.");

  const id = randomUUID();
  const root = uploadRoot();
  fs.mkdirSync(root, { recursive: true });
  const filePath = path.join(root, `${id}.pdf`);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  const payload: GenerationJobPayload = {
    ...input,
    questionSetId: randomUUID(),
    filePath,
    fileName: file.name,
  };
  try {
    await db.insert(jobs).values({
      id,
      ownerUserId,
      type: "generation",
      status: "queued",
      payloadJson: JSON.stringify(payload),
      progressTotal: Math.max(payload.blocks.length, 1),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    fs.rmSync(filePath, { force: true });
    if (error instanceof Error && /jobs_one_active_generation|unique/i.test(error.message)) {
      throw new Error("You already have a question set being generated.");
    }
    throw error;
  }
  registerJobKey(id, apiKey);
  void tick();
  return { jobId: id };
}

export async function enqueueGradingJob(
  attemptId: string,
  credential: { apiKey?: string; credentialOwnerUserId?: string },
) {
  const row = await db
    .select({
      ownerUserId: questionSets.ownerUserId,
      status: attempts.status,
      gradingJson: attempts.gradingJson,
      takerUsername: attempts.takerUsername,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .where(eq(attempts.id, attemptId))
    .get();
  if (!row) throw new Error("Attempt not found.");
  if (row.status === "graded" && row.gradingJson) {
    const result = JSON.parse(row.gradingJson) as AssessmentResult;
    return {
      result: {
        ...result,
        takerUsername: result.takerUsername ?? row.takerUsername,
      },
    };
  }
  const existing = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(
      and(
        eq(jobs.attemptId, attemptId),
        eq(jobs.type, "grading"),
        inArray(jobs.status, ACTIVE_STATUSES),
      ),
    )
    .get();
  if (existing) {
    if (credential.apiKey) registerJobKey(existing.id, credential.apiKey);
    return { jobId: existing.id, status: existing.status };
  }

  const id = randomUUID();
  try {
    await db.insert(jobs).values({
      id,
      ownerUserId: row.ownerUserId,
      type: "grading",
      status: "queued",
      payloadJson: JSON.stringify({
        attemptId,
        credentialOwnerUserId: credential.credentialOwnerUserId,
      }),
      attemptId,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    if (!(error instanceof Error) || !/jobs_one_active_grading|unique/i.test(error.message)) {
      throw error;
    }
    const raced = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(
        and(
          eq(jobs.attemptId, attemptId),
          eq(jobs.type, "grading"),
          inArray(jobs.status, ACTIVE_STATUSES),
        ),
      )
      .get();
    if (raced) return { jobId: raced.id, status: raced.status };
    throw error;
  }
  if (credential.apiKey) registerJobKey(id, credential.apiKey);
  void tick();
  return { jobId: id, status: "queued" };
}

export async function enqueueAutomaticGrading(attemptId: string) {
  const row = await db
    .select({
      workflowType: questionSets.workflowType,
      ownerUserId: questionSets.ownerUserId,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .where(eq(attempts.id, attemptId))
    .get();
  if (!row) throw new Error("Attempt not found.");
  if (row.workflowType === "conference") {
    return { pendingEvaluation: true as const, gradingCredentialRequired: true as const };
  }
  const grading = await enqueueGradingJob(attemptId, {
    credentialOwnerUserId: row.ownerUserId,
  });
  return {
    pendingEvaluation: true as const,
    gradingCredentialRequired: false as const,
    grading,
  };
}

export async function getOwnedJob(id: string, ownerUserId: string) {
  const job = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.ownerUserId, ownerUserId)))
    .get();
  if (!job) throw new Error("Job not found.");
  return publicJob(job);
}

export async function getConferenceJob(id: string, takerUserId: string) {
  const job = await db
    .select({ job: jobs })
    .from(jobs)
    .innerJoin(
      conferenceSubmissions,
      eq(conferenceSubmissions.generationJobId, jobs.id),
    )
    .where(
      and(
        eq(jobs.id, id),
        eq(conferenceSubmissions.takerUserId, takerUserId),
      ),
    )
    .get();
  if (!job) throw new Error("Job not found.");
  return publicJob(job.job);
}

export async function retryOwnedJob(id: string, ownerUserId: string, apiKey?: string) {
  const job = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.ownerUserId, ownerUserId), eq(jobs.status, "failed")))
    .get();
  if (!job) throw new Error("Retryable job not found.");
  if (job.type === "generation") {
    const payload = JSON.parse(job.payloadJson) as GenerationJobPayload;
    if (!fs.existsSync(payload.filePath)) {
      throw new Error("The uploaded PDF is no longer available. Start generation again.");
    }
    if (!apiKey && payload.workflowType === "course") {
      apiKey = await requireOpenRouterCredential(ownerUserId);
    }
  }
  if (!apiKey) throw new Error("Supply an OpenRouter key to retry this job.");
  registerJobKey(id, apiKey);
  await db
    .update(jobs)
    .set({
      status: "queued",
      error: null,
      runCount: 0,
      leaseUntil: null,
      completedAt: null,
    })
    .where(eq(jobs.id, id))
    .run();
  void tick();
  return { jobId: id, status: "queued" };
}

export async function getAttemptGradingJob(attemptId: string) {
  const attempt = await db
    .select({
      status: attempts.status,
      gradingJson: attempts.gradingJson,
      takerUsername: attempts.takerUsername,
      workflowType: questionSets.workflowType,
    })
    .from(attempts)
    .innerJoin(questionSets, eq(questionSets.id, attempts.questionSetId))
    .where(eq(attempts.id, attemptId))
    .get();
  if (!attempt) throw new Error("Attempt not found.");
  if (attempt.status === "graded" && attempt.gradingJson) {
    const result = JSON.parse(attempt.gradingJson) as AssessmentResult;
    return {
      status: "completed",
      result: {
        ...result,
        takerUsername: result.takerUsername ?? attempt.takerUsername,
      },
    };
  }
  const job = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.attemptId, attemptId), eq(jobs.type, "grading")))
    .orderBy(desc(jobs.createdAt))
    .get();
  return job
    ? {
        ...publicJob(job),
        gradingCredentialRequired:
          attempt.workflowType === "conference" && job.status === "failed",
      }
    : {
        status: "not_started",
        gradingCredentialRequired: attempt.workflowType === "conference",
      };
}

function publicJob(job: typeof jobs.$inferSelect) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    error: job.status === "failed" ? job.error : null,
    result: job.resultJson ? JSON.parse(job.resultJson) : null,
  };
}

async function claimNextJob() {
  const candidate = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.createdAt))
    .get();
  if (!candidate) return null;
  const now = new Date();
  const claimed = await db
    .update(jobs)
    .set({
      status: "running",
      startedAt: candidate.startedAt ?? now.toISOString(),
      leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      runCount: candidate.runCount + 1,
      error: null,
    })
    .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "queued")))
    .run();
  return claimed.changes === 1 ? { ...candidate, runCount: candidate.runCount + 1 } : null;
}

async function executeJob(job: typeof jobs.$inferSelect & { runCount: number }) {
  const heartbeat = setInterval(() => {
    void db
      .update(jobs)
      .set({ leaseUntil: new Date(Date.now() + LEASE_MS).toISOString() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")))
      .run();
  }, 60_000);
  heartbeat.unref();
  try {
    let result: unknown;
    if (job.type === "generation") {
      const apiKey = requireJobKey(job.id);
      const payload = JSON.parse(job.payloadJson) as GenerationJobPayload;
      result = await executeGeneration(job.ownerUserId, payload, apiKey, async (current, total) => {
        await db
          .update(jobs)
          .set({ progressCurrent: current, progressTotal: total })
          .where(eq(jobs.id, job.id))
          .run();
      });
      fs.rmSync(payload.filePath, { force: true });
    } else if (job.type === "grading") {
      const { attemptId, credentialOwnerUserId } = JSON.parse(job.payloadJson) as {
        attemptId: string;
        credentialOwnerUserId?: string;
      };
      const apiKey = credentialOwnerUserId
        ? await requireOpenRouterCredential(credentialOwnerUserId)
        : requireJobKey(job.id);
      const { ensureGraded } = await import("@/lib/grading");
      result = await ensureGraded(attemptId, apiKey);
    } else {
      throw new Error("Unknown job type.");
    }
    await db
      .update(jobs)
      .set({
        status: "completed",
        resultJson: JSON.stringify(result),
        progressCurrent: job.type === "generation" ? job.progressTotal : 1,
        completedAt: new Date().toISOString(),
        leaseUntil: null,
      })
      .where(eq(jobs.id, job.id))
      .run();
    deleteJobKey(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Background job failed.";
    const interrupted = error instanceof JobKeyUnavailableError;
    const retry = !interrupted && job.runCount < MAX_RUNS;
    if (!retry && !interrupted && job.type === "generation") {
      const payload = JSON.parse(job.payloadJson) as GenerationJobPayload;
      fs.rmSync(payload.filePath, { force: true });
      deleteManuscript(payload.questionSetId);
    }
    await db
      .update(jobs)
      .set({
        status: retry ? "queued" : "failed",
        error: message.slice(0, 1000),
        leaseUntil: null,
        completedAt: retry ? null : new Date().toISOString(),
      })
      .where(eq(jobs.id, job.id))
      .run();
    if (!retry) deleteJobKey(job.id);
  } finally {
    clearInterval(heartbeat);
    running -= 1;
    void tick();
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await db
      .update(jobs)
      .set({ status: "queued", leaseUntil: null })
      .where(and(eq(jobs.status, "running"), lt(jobs.leaseUntil, new Date().toISOString())))
      .run();
    while (running < concurrency()) {
      const job = await claimNextJob();
      if (!job) break;
      running += 1;
      void executeJob(job);
    }
  } finally {
    ticking = false;
  }
}

export async function startJobWorker() {
  if (workerStarted) return;
  workerStarted = true;
  // Temporary examinee keys intentionally do not survive restarts. Course grading jobs reference
  // an encrypted assessor credential and can safely be put back on the queue.
  const interrupted = await db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ACTIVE_STATUSES));
  for (const job of interrupted) {
    const payload = JSON.parse(job.payloadJson) as { credentialOwnerUserId?: string };
    const resumable = job.type === "grading" && Boolean(payload.credentialOwnerUserId);
    await db
      .update(jobs)
      .set({
        status: resumable ? "queued" : "failed",
        error: resumable
          ? null
          : "This job was interrupted by a server restart. Supply a key and run it again.",
        leaseUntil: null,
        completedAt: resumable ? null : new Date().toISOString(),
      })
      .where(eq(jobs.id, job.id))
      .run();
  }
  void tick();
  const timer = setInterval(() => void tick(), 1_000);
  timer.unref();
}
