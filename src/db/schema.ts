import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Named, reusable generation configurations. Never holds a PDF or a contribution statement. */
export const studyTemplates = sqliteTable(
  "study_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    configJson: text("config_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("study_templates_name_unique").on(table.name)],
);

/** Small key/value store. Holds the autosaved working config under `template_draft`. */
export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const questionSets = sqliteTable("question_sets", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  /** Human-chosen label for the set. Falls back to the PDF filename when left blank. */
  name: text("name"),
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
    // Display-only: the participant sees no timer, but every timing is still recorded.
    // Stored because whether a countdown was visible plausibly changes pacing.
    countdownHidden: integer("countdown_hidden", { mode: "boolean" })
      .notNull()
      .default(false),
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
    // Researcher-facing card name, snapshotted so exports can group answers by family
    // without joining through questions_json.
    blockName: text("block_name"),
    answerJson: text("answer_json"),
    startedAt: text("started_at").notNull(),
    firstInteractionAt: text("first_interaction_at"),
    firstInteractionMs: integer("first_interaction_ms"),
    submittedAt: text("submitted_at"),
    durationMs: integer("duration_ms"),
    timeLimitSeconds: integer("time_limit_seconds"),
    overrunMs: integer("overrun_ms"),
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

export type StudyTemplateRecord = typeof studyTemplates.$inferSelect;
export type QuestionSetRecord = typeof questionSets.$inferSelect;
export type AttemptRecord = typeof attempts.$inferSelect;
export type AttemptAnswerRecord = typeof attemptAnswers.$inferSelect;
