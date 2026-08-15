import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";

const databasePath = process.env.DATABASE_URL ?? "./data/research-captcha.db";
const absolutePath = path.resolve(process.cwd(), databasePath);

fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

const sqlite = new Database(absolutePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
