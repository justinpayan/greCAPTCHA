import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const questionSets = sqliteTable("question_sets", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  paperName: text("paper_name").notNull(),
  contributions: text("contributions").notNull(),
  modelId: text("model_id").notNull(),
  pdfEngine: text("pdf_engine").notNull(),
  configJson: text("config_json").notNull(),
  questionsJson: text("questions_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    questionSetId: text("question_set_id")
      .notNull()
      .references(() => questionSets.id, { onDelete: "cascade" }),
    randomize: integer("randomize", { mode: "boolean" }).notNull().default(false),
    questionOrderJson: text("question_order_json").notNull(),
    currentIndex: integer("current_index").notNull().default(0),
    status: text("status").notNull().default("active"),
    score: real("score"),
    gradingJson: text("grading_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("attempts_question_set_idx").on(table.questionSetId)],
);

export const attemptAnswers = sqliteTable(
  "attempt_answers",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    questionType: text("question_type").notNull(),
    answerJson: text("answer_json"),
    startedAt: text("started_at").notNull(),
    submittedAt: text("submitted_at"),
    durationMs: integer("duration_ms"),
    score: real("score"),
    feedbackJson: text("feedback_json"),
  },
  (table) => [
    uniqueIndex("attempt_answers_attempt_question_unique").on(
      table.attemptId,
      table.questionId,
    ),
    index("attempt_answers_attempt_idx").on(table.attemptId),
  ],
);

export type QuestionSetRecord = typeof questionSets.$inferSelect;
export type AttemptRecord = typeof attempts.$inferSelect;
export type AttemptAnswerRecord = typeof attemptAnswers.$inferSelect;
