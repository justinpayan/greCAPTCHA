import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  appState,
  attempts,
  conferenceSubmissions,
  jobs,
  questionSets,
  studyTemplates,
} from "@/db/schema";
import { deleteManuscript, deleteTemplateMaterial } from "@/lib/manuscripts";
import {
  readStoredAllowlist,
  serializeAllowlist,
} from "@/lib/allowlist";
import {
  generationConfigSchema,
  studyTemplateConfigSchema,
  type ApiKeyPayer,
  type MaterialUploader,
  type StudyTemplateConfig,
  type StudyTemplateSummary,
} from "@/lib/quiz";

const DRAFT_KEY = "template_draft";

export async function listTemplates(ownerUserId: string): Promise<StudyTemplateSummary[]> {
  const rows = await db
    .select({
      id: studyTemplates.id,
      name: studyTemplates.name,
      apiKeyPayer: studyTemplates.apiKeyPayer,
      materialUploader: studyTemplates.materialUploader,
      invitationShareToken: studyTemplates.invitationShareToken,
      updatedAt: studyTemplates.updatedAt,
    })
    .from(studyTemplates)
    .where(eq(studyTemplates.ownerUserId, ownerUserId))
    .orderBy(desc(studyTemplates.updatedAt));
  return rows as StudyTemplateSummary[];
}

export async function getTemplate(id: string, ownerUserId: string) {
  const row = await db
    .select()
    .from(studyTemplates)
    .where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, ownerUserId)))
    .get();
  if (!row) throw new Error("Template not found.");
  return {
    id: row.id,
    name: row.name,
    apiKeyPayer: row.apiKeyPayer as ApiKeyPayer,
    materialUploader: row.materialUploader as MaterialUploader,
    invitationShareToken: row.invitationShareToken,
    materialFileName: row.materialFileName,
    materialContributions: row.materialContributions,
    takerAllowlist: readStoredAllowlist(row.takerAllowlistJson),
    updatedAt: row.updatedAt,
    config: studyTemplateConfigSchema.parse(JSON.parse(row.configJson)),
  };
}

export async function saveTemplate(
  ownerUserId: string,
  name: string,
  config: StudyTemplateConfig,
  apiKeyPayer: ApiKeyPayer,
  materialUploader: MaterialUploader,
  templateId?: string | null,
  takerAllowlist?: string[] | null,
) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the template a name.");
  if (trimmed.length > 120) throw new Error("Template names are limited to 120 characters.");

  const now = new Date().toISOString();
  const configJson = JSON.stringify(config);
  const duplicateTemplate = await db
    .select()
    .from(studyTemplates)
    .where(
      and(
        eq(studyTemplates.ownerUserId, ownerUserId),
        sql`lower(${studyTemplates.name}) = lower(${trimmed})`,
        templateId ? ne(studyTemplates.id, templateId) : undefined,
      ),
    )
    .get();
  const duplicateSet = await db
    .select({ id: questionSets.id })
    .from(questionSets)
    .where(
      and(
        eq(questionSets.ownerUserId, ownerUserId),
        sql`lower(${questionSets.name}) = lower(${trimmed})`,
      ),
    )
    .get();
  if (duplicateTemplate || duplicateSet) {
    throw new Error(`You already have a test named “${trimmed}”. Choose a different name.`);
  }

  if (templateId) {
    const existing = await db
      .select()
      .from(studyTemplates)
      .where(
        and(
          eq(studyTemplates.id, templateId),
          eq(studyTemplates.ownerUserId, ownerUserId),
        ),
      )
      .get();
    if (!existing) throw new Error("Template not found.");
    const nextAllowlistJson =
      takerAllowlist === undefined
        ? existing.takerAllowlistJson
        : serializeAllowlist(takerAllowlist);
    await db
      .update(studyTemplates)
      .set({
        name: trimmed,
        configJson,
        apiKeyPayer,
        materialUploader,
        invitationShareToken:
          apiKeyPayer === "creator" && materialUploader === "creator"
            ? null
            : existing.invitationShareToken,
        takerAllowlistJson: nextAllowlistJson,
        updatedAt: now,
      })
      .where(eq(studyTemplates.id, existing.id))
      .run();
    return {
      id: existing.id,
      name: trimmed,
      apiKeyPayer,
      materialUploader,
      invitationShareToken:
        apiKeyPayer === "creator" && materialUploader === "creator"
          ? null
          : existing.invitationShareToken,
      updatedAt: now,
    };
  }

  const id = randomUUID();
  await db
    .insert(studyTemplates)
    .values({
      id,
      ownerUserId,
      name: trimmed,
      apiKeyPayer,
      materialUploader,
      configJson,
      takerAllowlistJson: serializeAllowlist(takerAllowlist ?? null),
      createdAt: now,
      updatedAt: now,
    });
  return {
    id,
    name: trimmed,
    apiKeyPayer,
    materialUploader,
    invitationShareToken: null,
    updatedAt: now,
  };
}

export async function setTemplateSharing(
  id: string,
  ownerUserId: string,
  enabled: boolean,
) {
  const template = await getTemplate(id, ownerUserId);
  if (template.apiKeyPayer === "creator" && template.materialUploader === "creator") {
    throw new Error("Generate this test before publishing its invitation.");
  }
  if (enabled) {
    if (!template.config.modelId.trim()) {
      throw new Error("Choose a model before publishing the invitation.");
    }
    const blocks = generationConfigSchema.parse(template.config.blocks);
    if (blocks.reduce((total, block) => total + block.count, 0) > 50) {
      throw new Error("An invitation template may contain at most 50 questions.");
    }
    if (template.materialUploader === "creator" && !template.materialFileName) {
      throw new Error("Upload the source material before publishing the invitation.");
    }
  }
  const invitationShareToken = enabled ? randomBytes(24).toString("base64url") : null;
  await db
    .update(studyTemplates)
    .set({ invitationShareToken, updatedAt: new Date().toISOString() })
    .where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, ownerUserId)))
    .run();
  return { invitationShareToken };
}

export async function getTemplateByInvitationToken(token: string) {
  const row = await db
    .select()
    .from(studyTemplates)
    .where(eq(studyTemplates.invitationShareToken, token))
    .get();
  if (!row) throw new Error("Assessment invitation not found.");
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    apiKeyPayer: row.apiKeyPayer as ApiKeyPayer,
    materialUploader: row.materialUploader as MaterialUploader,
    materialFileName: row.materialFileName,
    materialContributions: row.materialContributions,
    takerAllowlist: readStoredAllowlist(row.takerAllowlistJson),
    config: studyTemplateConfigSchema.parse(JSON.parse(row.configJson)),
  };
}

export async function setTemplateAllowlist(
  id: string,
  ownerUserId: string,
  allowlist: string[] | null,
) {
  const result = await db
    .update(studyTemplates)
    .set({
      takerAllowlistJson: serializeAllowlist(allowlist),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, ownerUserId)))
    .run();
  if (result.changes !== 1) throw new Error("Template not found.");
  return allowlist;
}

/** Backward-compatible names for existing `/conference` links and callers. */
export const setConferenceTemplateSharing = setTemplateSharing;
export const getConferenceTemplateByToken = getTemplateByInvitationToken;

export async function deleteTemplate(id: string, ownerUserId: string) {
  const template = await db
    .select({ id: studyTemplates.id })
    .from(studyTemplates)
    .where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, ownerUserId)))
    .get();
  if (!template) throw new Error("Template not found.");

  const deleted = db.transaction((tx) => {
    const linkedSets = tx
      .select({ id: questionSets.id })
      .from(questionSets)
      .where(
        and(
          eq(questionSets.ownerUserId, ownerUserId),
          eq(questionSets.sourceTemplateId, id),
        ),
      )
      .all();
    const setIds = linkedSets.map((set) => set.id);
    const linkedAttempts = setIds.length
      ? tx
          .select({ id: attempts.id })
          .from(attempts)
          .where(inArray(attempts.questionSetId, setIds))
          .all()
      : [];
    const attemptIds = linkedAttempts.map((attempt) => attempt.id);
    const submissions = tx
      .select({ generationJobId: conferenceSubmissions.generationJobId })
      .from(conferenceSubmissions)
      .where(
        and(
          eq(conferenceSubmissions.templateId, id),
          eq(conferenceSubmissions.administratorUserId, ownerUserId),
        ),
      )
      .all();
    const generationJobIds = submissions.flatMap((submission) =>
      submission.generationJobId ? [submission.generationJobId] : [],
    );

    tx.delete(conferenceSubmissions)
      .where(
        and(
          eq(conferenceSubmissions.templateId, id),
          eq(conferenceSubmissions.administratorUserId, ownerUserId),
        ),
      )
      .run();
    if (attemptIds.length) {
      tx.delete(jobs).where(inArray(jobs.attemptId, attemptIds)).run();
    }
    if (generationJobIds.length) {
      tx.delete(jobs).where(inArray(jobs.id, generationJobIds)).run();
    }
    if (setIds.length) {
      tx.delete(questionSets).where(inArray(questionSets.id, setIds)).run();
    }
    const deletedTemplate = tx
      .delete(studyTemplates)
      .where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, ownerUserId)))
      .run();
    if (deletedTemplate.changes !== 1) throw new Error("Template not found.");
    return { setIds, attemptIds };
  });

  for (const setId of deleted.setIds) deleteManuscript(setId);
  deleteTemplateMaterial(id);
  return {
    deletedQuestionSets: deleted.setIds.length,
    deletedAttempts: deleted.attemptIds.length,
  };
}

export async function getDraft(ownerUserId: string): Promise<StudyTemplateConfig | null> {
  const row = await db.select().from(appState).where(and(eq(appState.ownerUserId, ownerUserId), eq(appState.key, DRAFT_KEY))).get();
  if (!row) return null;
  const parsed = studyTemplateConfigSchema.safeParse(JSON.parse(row.value));
  // A draft written by an older build should be dropped, not crash the start screen.
  return parsed.success ? parsed.data : null;
}

export async function saveDraft(ownerUserId: string, config: StudyTemplateConfig) {
  const now = new Date().toISOString();
  await db
    .insert(appState)
    .values({ ownerUserId, key: DRAFT_KEY, value: JSON.stringify(config), updatedAt: now })
    .onConflictDoUpdate({
      target: [appState.ownerUserId, appState.key],
      set: { value: JSON.stringify(config), updatedAt: now },
    })
    .run();
}
