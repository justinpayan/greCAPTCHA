import "server-only";

import fs from "node:fs";
import path from "node:path";
import { eq, inArray, lte, sql } from "drizzle-orm";
import { db, databaseFile } from "@/db";
import { attemptFeedback, attempts, conferenceCredentials, conferenceSubmissions, fileDeletions, jobs, questionSets, studyTemplates, users } from "@/db/schema";
import { isInvitationTemplate } from "@/lib/quiz";
import { templateMaterialPath } from "@/lib/manuscripts";
import { deleteJobKey } from "@/lib/openrouter-key-store";
import { type Account, type Factor, hasFactor, assertAccountVersion, confirmPassword, consumeFactor } from "@/lib/account-security";

/** Call inside the database transaction that removes the owning records. */
export function queueFileDeletions(paths: string[]) {
  for (const file of paths) db.insert(fileDeletions).values({ path: file, notBefore: new Date().toISOString() }).onConflictDoNothing().run();
}

export function queueJobFileDeletions(rows: Array<typeof jobs.$inferSelect>) {
  queueFileDeletions(rows.flatMap((job) => {
    const payload = JSON.parse(job.payloadJson);
    return typeof payload.filePath === "string" ? [payload.filePath] : [];
  }));
}

export function runFileCleanup() {
  const root = path.dirname(databaseFile);
  for (const entry of db.select().from(fileDeletions).where(lte(fileDeletions.notBefore, new Date().toISOString())).all()) {
    const target = path.resolve(entry.path);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !/^(manuscripts|template-materials|job-uploads)[\\/]/.test(relative)) continue;
    try {
      fs.rmSync(target, { force: true });
      fs.rmSync(`${target}.partial`, { force: true });
      db.delete(fileDeletions).where(eq(fileDeletions.path, entry.path)).run();
    } catch { console.error("[account-deletion] File cleanup will be retried."); }
  }
}

export function hasRemainingTests(userId: string) {
  return Boolean(
    db.select({ id: questionSets.id }).from(questionSets).where(eq(questionSets.ownerUserId, userId)).get() ||
    db.select().from(studyTemplates).where(eq(studyTemplates.ownerUserId, userId)).all()
      .some((template) => isInvitationTemplate({ ...template, config: JSON.parse(template.configJson) }))
  );
}

export async function deleteAccount(account: Account, password: string, code: Factor, confirmation: string) {
  if (confirmation !== "DELETE") throw new Error("Type DELETE to confirm account deletion.");
  await confirmPassword(account, password);
  const cancelledJobIds = db.transaction(() => {
    assertAccountVersion(account);
    if (hasRemainingTests(account.id)) {
      throw new Error("Delete all of your tests from the dashboard before deleting your account.");
    }
    if (hasFactor(account)) consumeFactor(account, code);
    const submitted = db.select().from(conferenceSubmissions).where(eq(conferenceSubmissions.takerUserId, account.id)).all();
    const cancelled: string[] = [];
    for (const job of db.select().from(jobs).all()) {
      const payload = JSON.parse(job.payloadJson);
      const submission = submitted.find((entry) => entry.generationJobId === job.id || entry.id === payload.conferenceSubmissionId);
      if (submission) {
        // Keep the submitted material and job history under the test administrator's ownership.
        // Stop pending work before dropping the submitter's credentials.
        const pending = job.status === "queued" || job.status === "running";
        db.update(jobs).set({ ownerUserId: submission.administratorUserId,
          status: pending ? "failed" : job.status,
          error: pending ? "The submitter deleted their account before generation completed." : job.error,
          completedAt: pending ? new Date().toISOString() : job.completedAt,
          leaseUntil: null,
        }).where(eq(jobs.id, job.id)).run();
        if (pending) cancelled.push(job.id);
      } else if (job.ownerUserId === account.id) {
        if (payload.filePath) db.insert(fileDeletions).values({ path: payload.filePath, notBefore: new Date().toISOString() }).onConflictDoNothing().run();
        db.delete(jobs).where(eq(jobs.id, job.id)).run();
        cancelled.push(job.id);
      }
    }
    if (submitted.length) {
      db.delete(conferenceCredentials).where(inArray(conferenceCredentials.submissionId, submitted.map((entry) => entry.id))).run();
    }
    // Retain answers, grades, uploads and feedback, including the username captured at submission.
    db.update(attempts).set({ takerUserId: null, takerUsername: sql`coalesce(${attempts.takerUsername}, ${account.username})`, linkEnabled: false })
      .where(eq(attempts.takerUserId, account.id)).run();
    db.update(conferenceSubmissions).set({ takerUserId: null, launchHash: null, launchExpiresAt: null,
      sebSessionHash: null, sebSessionExpiresAt: null }).where(eq(conferenceSubmissions.takerUserId, account.id)).run();
    db.update(attemptFeedback).set({ submitterUserId: null }).where(eq(attemptFeedback.submitterUserId, account.id)).run();
    // Explicit deletion also supports older databases whose template owner FK does not cascade.
    const templates = db.select({ id: studyTemplates.id }).from(studyTemplates)
      .where(eq(studyTemplates.ownerUserId, account.id)).all();
    queueFileDeletions(templates.flatMap(({ id }) => [templateMaterialPath(id, "pdf"), templateMaterialPath(id, "code")]));
    db.delete(studyTemplates).where(eq(studyTemplates.ownerUserId, account.id)).run();
    db.delete(users).where(eq(users.id, account.id)).run();
    return cancelled;
  });
  for (const id of cancelledJobIds) deleteJobKey(id);
  runFileCleanup();
}
