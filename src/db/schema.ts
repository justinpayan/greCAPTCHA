import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_username_normalized_unique").on(table.usernameNormalized),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const openRouterCredentials = sqliteTable(
  "openrouter_credentials",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    label: text("label"),
    spendingLimit: real("spending_limit").notNull(),
    limitRemaining: real("limit_remaining"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("openrouter_credentials_expiry_idx").on(table.expiresAt)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status").notNull().default("queued"),
    payloadJson: text("payload_json").notNull(),
    resultJson: text("result_json"),
    error: text("error"),
    attemptId: text("attempt_id"),
    progressCurrent: integer("progress_current").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(1),
    runCount: integer("run_count").notNull().default(0),
    leaseUntil: text("lease_until"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("jobs_status_created_idx").on(table.status, table.createdAt),
    index("jobs_owner_created_idx").on(table.ownerUserId, table.createdAt),
    index("jobs_attempt_idx").on(table.attemptId),
    uniqueIndex("jobs_one_active_generation")
      .on(table.ownerUserId)
      .where(sql`${table.type} = 'generation' AND ${table.status} IN ('queued', 'running')`),
    uniqueIndex("jobs_one_active_grading")
      .on(table.attemptId)
      .where(sql`${table.type} = 'grading' AND ${table.status} IN ('queued', 'running')`),
  ],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStartedAt: text("window_started_at").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [index("rate_limits_window_idx").on(table.windowStartedAt)],
);

/** Named, reusable generation configurations. Never holds a PDF or a contribution statement. */
export const studyTemplates = sqliteTable(
  "study_templates",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    workflowType: text("workflow_type").notNull().default("course"),
    conferenceShareToken: text("conference_share_token"),
    configJson: text("config_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("study_templates_owner_name_unique").on(table.ownerUserId, table.name),
    index("study_templates_owner_idx").on(table.ownerUserId),
    uniqueIndex("study_templates_conference_share_token_unique").on(
      table.conferenceShareToken,
    ),
  ],
);

/** Small key/value store. Holds the autosaved working config under `template_draft`. */
export const appState = sqliteTable(
  "app_state",
  {
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUserId, table.key] }),
    index("app_state_owner_idx").on(table.ownerUserId),
  ],
);

export const questionSets = sqliteTable(
  "question_sets",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceTemplateId: text("source_template_id").references(() => studyTemplates.id, {
      onDelete: "set null",
    }),
    workflowType: text("workflow_type").notNull().default("course"),
    schemaVersion: integer("schema_version").notNull().default(1),
    /** Human-chosen label for the set. Falls back to the PDF filename when left blank. */
    name: text("name"),
    paperName: text("paper_name").notNull(),
    contributions: text("contributions").notNull(),
    modelId: text("model_id").notNull(),
    pdfEngine: text("pdf_engine").notNull(),
    /**
     * Budget for the whole set, in seconds, or null for no overall limit. Unlike the per-question
     * soft limits this one is enforced: once it is spent no further question is served.
     */
    overallTimeLimitSeconds: integer("overall_time_limit_seconds"),
    configJson: text("config_json").notNull(),
    questionsJson: text("questions_json").notNull(),
    /** Unguessable capability used by the reusable, login-required assessment URL. */
    shareToken: text("share_token"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("question_sets_owner_idx").on(table.ownerUserId),
    index("question_sets_source_template_idx").on(table.sourceTemplateId),
    uniqueIndex("question_sets_share_token_unique").on(table.shareToken),
  ],
);

export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    questionSetId: text("question_set_id")
      .notNull()
      .references(() => questionSets.id, { onDelete: "cascade" }),
    randomize: integer("randomize", { mode: "boolean" }).notNull().default(false),
    // Gates participant access to the link. Links are handed out ahead of a session, so a
    // new attempt is created closed and armed when the session starts; see
    // `requireOpenAttempt`. Defaults to true at the column level so attempts that predate
    // the flag stay reachable — the closed default belongs to `createAttempt`, not here.
    linkEnabled: integer("link_enabled", { mode: "boolean" }).notNull().default(true),
    // Set only for public share links. Null keeps owner-created and legacy attempts unchanged.
    // The signed-in account taking this response.
    takerUserId: text("taker_user_id").references(() => users.id),
    takerUsername: text("taker_username"),
    // Display-only: the participant sees no timer, but every timing is still recorded.
    // Stored because whether a countdown was visible plausibly changes pacing.
    countdownHidden: integer("countdown_hidden", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * Snapshotted from the question set at creation, for the same reason the per-question limit
     * is snapshotted onto each answer: editing a set must not change the budget of an attempt
     * that is already under way.
     */
    overallTimeLimitSeconds: integer("overall_time_limit_seconds"),
    questionOrderJson: text("question_order_json").notNull(),
    currentIndex: integer("current_index").notNull().default(0),
    // Start of the current question's active visit. Moving to another question rolls this
    // interval into that answer's duration before replacing the timestamp.
    activeQuestionStartedAt: text("active_question_started_at"),
    status: text("status").notNull().default("active"),
    score: real("score"),
    gradingJson: text("grading_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("attempts_question_set_idx").on(table.questionSetId),
    index("attempts_taker_idx").on(table.takerUserId),
  ],
);

export const conferenceSubmissions = sqliteTable(
  "conference_submissions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => studyTemplates.id, { onDelete: "restrict" }),
    assessorUserId: text("assessor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    takerUserId: text("taker_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    generationJobId: text("generation_job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    questionSetId: text("question_set_id").references(() => questionSets.id, {
      onDelete: "set null",
    }),
    attemptId: text("attempt_id").references(() => attempts.id, {
      onDelete: "set null",
    }),
    paperName: text("paper_name").notNull(),
    contributions: text("contributions").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("conference_submissions_template_idx").on(table.templateId),
    index("conference_submissions_assessor_idx").on(table.assessorUserId),
    index("conference_submissions_taker_idx").on(table.takerUserId),
    uniqueIndex("conference_submissions_job_unique").on(table.generationJobId),
    uniqueIndex("conference_submissions_attempt_unique").on(table.attemptId),
  ],
);

export const attemptFeedback = sqliteTable(
  "attempt_feedback",
  {
    attemptId: text("attempt_id")
      .primaryKey()
      .references(() => attempts.id, { onDelete: "cascade" }),
    submitterUserId: text("submitter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    comment: text("comment").notNull(),
    submittedAt: text("submitted_at").notNull(),
  },
  (table) => [index("attempt_feedback_submitter_idx").on(table.submitterUserId)],
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
    /**
     * The participant declined the question rather than answering it. Scored 0 and locked
     * like any other submission, but recorded separately: "declined" and "attempted and got
     * it wrong" are different behaviours, and only an explicit flag lets an analysis exclude
     * the former. `answer_json` is null on a skipped row.
     */
    skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
    /**
     * The overall budget ran out before this question was answered. Scored 0 like a skip, but
     * recorded apart from it: "ran out of time" and "declined to answer" are different
     * behaviours, and a per-family analysis that merged them would be misled.
     */
    timedOut: integer("timed_out", { mode: "boolean" }).notNull().default(false),
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

export type UserRecord = typeof users.$inferSelect;
export type StudyTemplateRecord = typeof studyTemplates.$inferSelect;
export type QuestionSetRecord = typeof questionSets.$inferSelect;
export type AttemptRecord = typeof attempts.$inferSelect;
export type ConferenceSubmissionRecord = typeof conferenceSubmissions.$inferSelect;
export type AttemptFeedbackRecord = typeof attemptFeedback.$inferSelect;
export type AttemptAnswerRecord = typeof attemptAnswers.$inferSelect;
