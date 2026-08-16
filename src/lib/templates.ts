import "server-only";

import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { appState, studyTemplates } from "@/db/schema";
import {
  studyTemplateConfigSchema,
  type StudyTemplateConfig,
  type StudyTemplateSummary,
} from "@/lib/quiz";

const DRAFT_KEY = "template_draft";

export async function listTemplates(): Promise<StudyTemplateSummary[]> {
  const rows = await db
    .select({
      id: studyTemplates.id,
      name: studyTemplates.name,
      updatedAt: studyTemplates.updatedAt,
    })
    .from(studyTemplates)
    .orderBy(desc(studyTemplates.updatedAt));
  return rows;
}

export async function getTemplate(id: string) {
  const row = await db
    .select()
    .from(studyTemplates)
    .where(eq(studyTemplates.id, id))
    .get();
  if (!row) throw new Error("Template not found.");
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    config: studyTemplateConfigSchema.parse(JSON.parse(row.configJson)),
  };
}

/** Saving under an existing name replaces that template rather than creating a duplicate. */
export async function saveTemplate(name: string, config: StudyTemplateConfig) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the template a name.");
  if (trimmed.length > 120) throw new Error("Template names are limited to 120 characters.");

  const now = new Date().toISOString();
  const configJson = JSON.stringify(config);
  const existing = await db
    .select()
    .from(studyTemplates)
    .where(eq(studyTemplates.name, trimmed))
    .get();

  if (existing) {
    await db
      .update(studyTemplates)
      .set({ configJson, updatedAt: now })
      .where(eq(studyTemplates.id, existing.id))
      .run();
    return { id: existing.id, name: trimmed, updatedAt: now };
  }

  const id = randomUUID();
  await db
    .insert(studyTemplates)
    .values({ id, name: trimmed, configJson, createdAt: now, updatedAt: now });
  return { id, name: trimmed, updatedAt: now };
}

export async function deleteTemplate(id: string) {
  const result = await db.delete(studyTemplates).where(eq(studyTemplates.id, id)).run();
  if (result.changes !== 1) throw new Error("Template not found.");
}

export async function getDraft(): Promise<StudyTemplateConfig | null> {
  const row = await db.select().from(appState).where(eq(appState.key, DRAFT_KEY)).get();
  if (!row) return null;
  const parsed = studyTemplateConfigSchema.safeParse(JSON.parse(row.value));
  // A draft written by an older build should be dropped, not crash the start screen.
  return parsed.success ? parsed.data : null;
}

export async function saveDraft(config: StudyTemplateConfig) {
  const now = new Date().toISOString();
  await db
    .insert(appState)
    .values({ key: DRAFT_KEY, value: JSON.stringify(config), updatedAt: now })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value: JSON.stringify(config), updatedAt: now },
    })
    .run();
}
