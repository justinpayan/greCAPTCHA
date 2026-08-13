import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const databasePath = process.env.DATABASE_URL ?? "./data/research-captcha.db";
const absolutePath = path.resolve(process.cwd(), databasePath);

fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

const sqlite = new Database(absolutePath);
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY NOT NULL,
    paper_name TEXT NOT NULL,
    contributions TEXT NOT NULL,
    question_count INTEGER NOT NULL,
    distractors_per_blank INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    pdf_engine TEXT NOT NULL,
    questions_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    answers_json TEXT,
    score REAL,
    passed INTEGER,
    created_at TEXT NOT NULL,
    submitted_at TEXT
  )
`);

export const db = drizzle(sqlite);
