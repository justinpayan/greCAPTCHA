import "server-only";

import fs from "node:fs";
import path from "node:path";

import { databaseFile } from "@/db";
import { readEncryptedFile, writeEncryptedFile } from "@/lib/data-encryption";
import type { MaterialKind } from "@/lib/quiz";

/**
 * A set's or template's source material on disk: the manuscript PDF, or for a codebase the
 * normalised code bundle (see `code-bundle.ts`). Same directories either way, so backup,
 * restore, and at-rest encryption need no changes; the extension tells the two apart.
 */
const EXTENSIONS: Record<MaterialKind, string> = { pdf: ".pdf", code: ".code.json" };

function safeQuestionSetId(questionSetId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(questionSetId)) {
    throw new Error("Invalid question set ID.");
  }
  return questionSetId;
}

function manuscriptRoot(): string {
  return path.join(path.dirname(databaseFile), "manuscripts");
}

function templateMaterialRoot(): string {
  return path.join(path.dirname(databaseFile), "template-materials");
}

export function manuscriptPath(questionSetId: string, kind: MaterialKind = "pdf"): string {
  return path.join(manuscriptRoot(), `${safeQuestionSetId(questionSetId)}${EXTENSIONS[kind]}`);
}

/** Copies a completed generation upload into durable storage without exposing a partial file. */
export function persistManuscript(
  sourcePath: string,
  questionSetId: string,
  kind: MaterialKind = "pdf",
): void {
  const root = manuscriptRoot();
  fs.mkdirSync(root, { recursive: true });
  const destination = manuscriptPath(questionSetId, kind);
  writeEncryptedFile(
    destination,
    readEncryptedFile(sourcePath, "job-upload"),
    "manuscript",
  );
}

export function readManuscript(questionSetId: string, kind: MaterialKind = "pdf"): Buffer {
  return readEncryptedFile(manuscriptPath(questionSetId, kind), "manuscript");
}

/** Removes the set's material of either kind, so callers need not know which it had. */
export function deleteManuscript(questionSetId: string): void {
  fs.rmSync(manuscriptPath(questionSetId, "pdf"), { force: true });
  fs.rmSync(manuscriptPath(questionSetId, "code"), { force: true });
}

export function templateMaterialPath(templateId: string, kind: MaterialKind = "pdf"): string {
  return path.join(templateMaterialRoot(), `${safeQuestionSetId(templateId)}${EXTENSIONS[kind]}`);
}

/** Replaces the template's material, removing one of the other kind left from before. */
export async function persistTemplateMaterial(
  source: { arrayBuffer(): Promise<ArrayBuffer> },
  templateId: string,
  kind: MaterialKind = "pdf",
): Promise<void> {
  const root = templateMaterialRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.rmSync(templateMaterialPath(templateId, kind === "pdf" ? "code" : "pdf"), { force: true });
  const destination = templateMaterialPath(templateId, kind);
  writeEncryptedFile(
    destination,
    Buffer.from(await source.arrayBuffer()),
    "template-material",
  );
}

export function readTemplateMaterial(templateId: string, kind: MaterialKind = "pdf"): Buffer {
  return readEncryptedFile(templateMaterialPath(templateId, kind), "template-material");
}

export function deleteTemplateMaterial(templateId: string): void {
  fs.rmSync(templateMaterialPath(templateId, "pdf"), { force: true });
  fs.rmSync(templateMaterialPath(templateId, "code"), { force: true });
}
