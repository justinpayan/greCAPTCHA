import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const quizzes = sqliteTable("quizzes", {
  id: text("id").primaryKey(),
  paperName: text("paper_name").notNull(),
  contributions: text("contributions").notNull(),
  questionCount: integer("question_count").notNull(),
  distractorsPerBlank: integer("distractors_per_blank").notNull(),
  modelId: text("model_id").notNull(),
  pdfEngine: text("pdf_engine").notNull(),
  questionsJson: text("questions_json").notNull(),
  status: text("status").notNull().default("active"),
  answersJson: text("answers_json"),
  score: real("score"),
  passed: integer("passed", { mode: "boolean" }),
  createdAt: text("created_at").notNull(),
  submittedAt: text("submitted_at"),
});

export type QuizRecord = typeof quizzes.$inferSelect;
