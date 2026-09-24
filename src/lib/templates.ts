import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { appState, studyTemplates } from "@/db/schema";
import {
  generationConfigSchema,
  studyTemplateConfigSchema,
  type StudyTemplateConfig,
  type StudyTemplateSummary,
  type WorkflowType,
} from "@/lib/quiz";

const DRAFT_KEY = "template_draft";

export async function listTemplates(ownerUserId: string): Promise<StudyTemplateSummary[]> {
  const rows = await db
    .select({
      id: studyTemplates.id,
      name: studyTemplates.name,
      workflowType: studyTemplates.workflowType,
      conferenceShareToken: studyTemplates.conferenceShareToken,
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
    workflowType: row.workflowType as WorkflowType,
    conferenceShareToken: row.conferenceShareToken,
    updatedAt: row.updatedAt,
    config: studyTemplateConfigSchema.parse(JSON.parse(row.configJson)),
  };
}

/** Saving under an existing name replaces that template rather than creating a duplicate. */
export async function saveTemplate(
  ownerUserId: string,
  name: string,
  config: StudyTemplateConfig,
  workflowType: WorkflowType,
) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the template a name.");
  if (trimmed.length > 120) throw new Error("Template names are limited to 120 characters.");

  const now = new Date().toISOString();
  const configJson = JSON.stringify(config);
  const existing = await db
    .select()
    .from(studyTemplates)
    .where(and(eq(studyTemplates.ownerUserId, ownerUserId), eq(studyTemplates.name, trimmed)))
    .get();

  if (existing) {
    await db
      .update(studyTemplates)
      .set({
        configJson,
        workflowType,
        conferenceShareToken:
          workflowType === "conference" ? existing.conferenceShareToken : null,
        updatedAt: now,
      })
      .where(eq(studyTemplates.id, existing.id))
      .run();
    return {
      id: existing.id,
      name: trimmed,
      workflowType,
      conferenceShareToken:
        workflowType === "conference" ? existing.conferenceShareToken : null,
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
      workflowType,
      configJson,
      createdAt: now,
      updatedAt: now,
    });
  return { id, name: trimmed, workflowType, conferenceShareToken: null, updatedAt: now };
}

export async function setConferenceTemplateSharing(
  id: string,
  ownerUserId: string,
  enabled: boolean,
) {
  const template = await getTemplate(id, ownerUserId);
  if (template.workflowType !== "conference") {
    throw new Error("Only conference templates can publish an examinee link.");
  }
  if (enabled) {
    if (!template.config.modelId.trim()) {
      throw new Error("Choose a model before publishing the conference link.");
    }
    const blocks = generationConfigSchema.parse(template.config.blocks);
    if (blocks.reduce((total, block) => total + block.count, 0) > 50) {
      throw new Error("A conference template may contain at most 50 questions.");
    }
  }
  const conferenceShareToken = enabled ? randomBytes(24).toString("base64url") : null;
  await db
    .update(studyTemplates)
    .set({ conferenceShareToken, updatedAt: new Date().toISOString() })
    .where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, ownerUserId)))
    .run();
  return { conferenceShareToken };
}

export async function getConferenceTemplateByToken(token: string) {
  const row = await db
    .select()
    .from(studyTemplates)
    .where(
      and(
        eq(studyTemplates.conferenceShareToken, token),
        eq(studyTemplates.workflowType, "conference"),
      ),
    )
    .get();
  if (!row) throw new Error("Conference invitation not found.");
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    config: studyTemplateConfigSchema.parse(JSON.parse(row.configJson)),
  };
}

export async function deleteTemplate(id: string, ownerUserId: string) {
  const result = await db.delete(studyTemplates).where(and(eq(studyTemplates.id, id), eq(studyTemplates.ownerUserId, ownerUserId))).run();
  if (result.changes !== 1) throw new Error("Template not found.");
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
