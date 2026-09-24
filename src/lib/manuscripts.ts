import "server-only";

import fs from "node:fs";
import path from "node:path";

import { databaseFile } from "@/db";

function safeQuestionSetId(questionSetId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(questionSetId)) {
    throw new Error("Invalid question set ID.");
  }
  return questionSetId;
}

function manuscriptRoot(): string {
  return path.join(path.dirname(databaseFile), "manuscripts");
}

export function manuscriptPath(questionSetId: string): string {
  return path.join(manuscriptRoot(), `${safeQuestionSetId(questionSetId)}.pdf`);
}

/** Copies a completed generation upload into durable storage without exposing a partial file. */
export function persistManuscript(sourcePath: string, questionSetId: string): void {
  const root = manuscriptRoot();
  fs.mkdirSync(root, { recursive: true });
  const destination = manuscriptPath(questionSetId);
  const staging = `${destination}.partial`;
  fs.rmSync(staging, { force: true });
  try {
    fs.copyFileSync(sourcePath, staging);
    fs.renameSync(staging, destination);
  } finally {
    fs.rmSync(staging, { force: true });
  }
}

export function deleteManuscript(questionSetId: string): void {
  fs.rmSync(manuscriptPath(questionSetId), { force: true });
}
