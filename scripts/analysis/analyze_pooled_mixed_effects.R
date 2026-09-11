#!/usr/bin/env Rscript

# Fit the reduced question-type-pooled authorship GLMM.

required_packages <- c(
  "data.table", "dplyr", "tidyr", "jsonlite", "detectseparation", "knitr",
  "sandwich", "lmtest"
)
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0) {
  stop(
    "Missing R packages: ", paste(missing_packages, collapse = ", "),
    ". Run scripts/analysis/install_r_dependencies.R first.",
    call. = FALSE
  )
}

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1 || length(args) > 2) {
  stop(
    "Usage: Rscript scripts/analysis/analyze_pooled_mixed_effects.R ",
    "<private.csv-or-tsv> [output-directory]",
    call. = FALSE
  )
}

input_path <- normalizePath(args[[1]], mustWork = TRUE)
output_dir <- if (length(args) == 2) args[[2]] else "pooled_mixed_effects_output"
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
latex_dir <- file.path(output_dir, "latex")
dir.create(latex_dir, recursive = TRUE, showWarnings = FALSE)

required_columns <- c(
  "participant_id", "paper_order", "paper_position", "field_type", "position",
  "question_target", "duration_ms", "score", "skipped", "timed_out", "response"
)
target_levels <- c(
  "Planted error", "Unstated rationale", "Background knowledge", "Failure mode"
)
target_keys <- c(
  "planted_error", "unstated_rationale", "background_knowledge", "failure_mode"
)
free_response_targets <- target_levels[2:4]
canonical_mapping <- data.frame(
  canonical_question = paste0("q", 1:8),
  question_type = rep(target_levels, each = 2),
  within_type_position = rep(1:2, times = 4),
  stringsAsFactors = FALSE
)
data.table::fwrite(
  canonical_mapping,
  file.path(output_dir, "canonical_question_mapping.csv")
)

issues <- data.frame(
  severity = character(),
  check = character(),
  input_row = integer(),
  participant_id = character(),
  paper_id = integer(),
  message = character(),
  stringsAsFactors = FALSE
)

add_issue <- function(
    check, message, input_row = NA_integer_, participant_id = NA_character_,
    paper_id = NA_integer_, severity = "error") {
  issues <<- bind_rows(
    issues,
    data.frame(
      severity = severity,
      check = check,
      input_row = as.integer(input_row),
      participant_id = as.character(participant_id),
      paper_id = as.integer(paper_id),
      message = as.character(message),
      stringsAsFactors = FALSE
    )
  )
}

write_validation_outputs <- function(checks) {
  data.table::fwrite(checks, file.path(output_dir, "validation_report.csv"))
  data.table::fwrite(issues, file.path(output_dir, "invalid_rows.csv"))
  invalid_tests <- issues %>%
    filter(!is.na(participant_id)) %>%
    distinct(participant_id, paper_id, check, message)
  data.table::fwrite(
    invalid_tests,
    file.path(output_dir, "invalid_tests.csv")
  )
}

normalize_text <- function(value) {
  tolower(trimws(gsub("\\s+", " ", as.character(value))))
}

parse_boolean <- function(value, column, rows) {
  normalized <- normalize_text(value)
  parsed <- ifelse(
    normalized %in% c("true", "1", "yes"), 1L,
    ifelse(normalized %in% c("false", "0", "no"), 0L, NA_integer_)
  )
  for (index in which(is.na(parsed))) {
    add_issue(
      "boolean_parse",
      sprintf("Missing or invalid %s value '%s'.", column, value[[index]]),
      input_row = rows[[index]]
    )
  }
  parsed
}

parse_numeric <- function(value, column, rows, integer_only = FALSE) {
  parsed <- suppressWarnings(as.numeric(trimws(as.character(value))))
  invalid <- is.na(parsed) | !is.finite(parsed)
  if (integer_only) {
    invalid <- invalid | (!is.na(parsed) & abs(parsed - round(parsed)) > 1e-9)
  }
  for (index in which(invalid)) {
    add_issue(
      "numeric_parse",
      sprintf("Missing or invalid %s value '%s'.", column, value[[index]]),
      input_row = rows[[index]]
    )
  }
  if (integer_only) as.integer(round(parsed)) else parsed
}

raw <- data.table::fread(
  input_path,
  sep = "auto",
  colClasses = "character",
  na.strings = c("NA", "NaN", "NULL"),
  data.table = FALSE,
  check.names = FALSE,
  strip.white = FALSE
)
normalized_names <- tolower(trimws(names(raw)))
duplicate_names <- unique(normalized_names[duplicated(normalized_names)])
if (length(duplicate_names) > 0) {
  add_issue(
    "duplicate_columns",
    paste("Duplicate normalized column names:", paste(duplicate_names, collapse = ", "))
  )
  checks <- data.frame(
    check = "unique_normalized_columns", passed = FALSE,
    details = paste(duplicate_names, collapse = ", "),
    stringsAsFactors = FALSE
  )
  write_validation_outputs(checks)
  stop("Duplicate normalized columns; see validation outputs.", call. = FALSE)
}
names(raw) <- normalized_names
if (nrow(raw) == 0) {
  add_issue("nonempty_input", "The input contains no data rows.")
  checks <- data.frame(
    check = "nonempty_input", passed = FALSE,
    details = "The input contains no data rows.",
    stringsAsFactors = FALSE
  )
  write_validation_outputs(checks)
  jsonlite::write_json(
    list(status = "validation_failed", reason = "empty_input"),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE
  )
  stop("Input contains no rows; see validation outputs.", call. = FALSE)
}
missing_columns <- setdiff(required_columns, names(raw))
if (length(missing_columns) > 0) {
  add_issue(
    "required_columns",
    paste("Missing columns:", paste(missing_columns, collapse = ", "))
  )
  checks <- data.frame(
    check = "required_columns", passed = FALSE,
    details = paste(missing_columns, collapse = ", "),
    stringsAsFactors = FALSE
  )
  write_validation_outputs(checks)
  jsonlite::write_json(
    list(status = "validation_failed", missing_columns = missing_columns),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE
  )
  stop("Required columns are missing; see validation outputs.", call. = FALSE)
}

data <- raw %>%
  mutate(
    input_row = row_number() + 1L,
    participant_id = trimws(as.character(participant_id)),
    paper_order = normalize_text(paper_order),
    field_type = normalize_text(field_type),
    field_type = recode(field_type, out_of_field = "out_field"),
    question_target_source = as.character(question_target),
    question_target_normalized = normalize_text(question_target),
    question_target = case_when(
      question_target_normalized == "planted error" ~ "Planted error",
      question_target_normalized == "unstated rationale" ~ "Unstated rationale",
      question_target_normalized %in% c(
        "background knowledge", "background knowlegde", "background knowledgde"
      ) ~ "Background knowledge",
      question_target_normalized == "failure mode" ~ "Failure mode",
      TRUE ~ NA_character_
    )
  )
data$paper_position <- parse_numeric(
  data$paper_position, "paper_position", data$input_row, integer_only = TRUE
)
data$position <- parse_numeric(
  data$position, "position", data$input_row, integer_only = TRUE
)
data$duration_ms <- parse_numeric(
  data$duration_ms, "duration_ms", data$input_row
)
data$score <- parse_numeric(data$score, "score", data$input_row)
data$skipped <- parse_boolean(data$skipped, "skipped", data$input_row)
data$timed_out <- parse_boolean(data$timed_out, "timed_out", data$input_row)
for (index in which(!is.na(data$duration_ms) & data$duration_ms < 0)) {
  add_issue(
    "duration_range", "duration_ms must be nonnegative.",
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
for (index in which(!is.na(data$score) & (data$score < 0 | data$score > 100))) {
  add_issue(
    "score_range", "score must be between 0 and 100.",
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}

for (index in which(is.na(data$participant_id) | data$participant_id == "")) {
  add_issue("participant_id", "participant_id is missing.", data$input_row[[index]])
}
for (index in which(!data$paper_order %in% c("own", "foreign"))) {
  add_issue(
    "paper_order", sprintf("Invalid paper_order '%s'.", data$paper_order[[index]]),
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
for (index in which(!data$field_type %in% c("in_field", "out_field"))) {
  add_issue(
    "field_type", sprintf("Invalid field_type '%s'.", data$field_type[[index]]),
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
for (index in which(!data$paper_position %in% c(1L, 2L))) {
  add_issue(
    "paper_position", "paper_position must be 1 or 2.",
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
for (index in which(!data$position %in% 1:8)) {
  add_issue(
    "position", "position must be an integer from 1 through 8.",
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
for (index in which(is.na(data$question_target))) {
  add_issue(
    "question_target",
    sprintf("Unrecognized question_target '%s'.", data$question_target_source[[index]]),
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}

for (index in which(data$skipped == 1L & data$timed_out == 1L)) {
  add_issue(
    "mutually_exclusive_status", "skipped and timed_out are both true.",
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
data <- data %>%
  mutate(
    status = case_when(
      timed_out == 0L & skipped == 0L ~ "completed",
      timed_out == 0L & skipped == 1L ~ "skipped",
      timed_out == 1L & skipped == 0L ~ "timed_out",
      TRUE ~ NA_character_
    ),
    completed = status == "completed",
    is_free_response = question_target %in% free_response_targets,
    raw_answer_length = ifelse(
      is.na(response), NA_integer_, nchar(enc2utf8(response), type = "chars")
    )
  )
for (index in which(is.na(data$score) | is.na(data$duration_ms))) {
  add_issue(
    "missing_measurement", "score or duration_ms is missing.",
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
for (index in which(
  data$status %in% c("skipped", "timed_out") &
    !is.na(data$score) & data$score != 0
)) {
  add_issue(
    "structural_zero_score",
    sprintf("%s question has nonzero score.", data$status[[index]]),
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
for (index in which(
  data$is_free_response &
    data$status %in% c("skipped", "timed_out") &
    !is.na(data$raw_answer_length) & data$raw_answer_length != 0
)) {
  add_issue(
    "structural_zero_answer_length",
    sprintf("%s free-response question has nonempty response.", data$status[[index]]),
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}

participant_groups <- split(data, data$participant_id, drop = TRUE)
for (participant_id in names(participant_groups)) {
  rows <- participant_groups[[participant_id]]
  papers <- sort(unique(rows$paper_position))
  if (length(papers) != 2 || !identical(papers, c(1L, 2L))) {
    add_issue(
      "two_tests_per_participant",
      sprintf("Expected paper positions 1 and 2; found %s.", paste(papers, collapse = ", ")),
      participant_id = participant_id
    )
  }
  first_orders <- unique(rows$paper_order[rows$paper_position == 1L])
  first_orders <- first_orders[!is.na(first_orders)]
  if (length(first_orders) != 1) {
    add_issue(
      "first_paper_order",
      "Position-1 rows do not define exactly one paper_order.",
      participant_id = participant_id
    )
  }
  fields <- unique(rows$field_type[!is.na(rows$field_type)])
  if (length(fields) != 1) {
    add_issue(
      "participant_field",
      "Foreign-paper field stratum is not unique within participant.",
      participant_id = participant_id
    )
  }
}

test_groups <- split(
  data,
  interaction(data$participant_id, data$paper_position, drop = TRUE),
  drop = TRUE
)
for (rows in test_groups) {
  participant_id <- rows$participant_id[[1]]
  paper_id <- rows$paper_position[[1]]
  if (nrow(rows) != 8) {
    add_issue(
      "eight_questions_per_test",
      sprintf("Expected 8 questions; found %d.", nrow(rows)),
      participant_id = participant_id, paper_id = paper_id
    )
  }
  positions <- sort(rows$position)
  if (
    length(positions) != 8 || any(is.na(positions)) ||
      !identical(positions, 1:8)
  ) {
    add_issue(
      "unique_original_positions",
      sprintf("Expected positions 1-8; found %s.", paste(positions, collapse = ", ")),
      participant_id = participant_id, paper_id = paper_id
    )
  }
  type_counts <- table(factor(rows$question_target, levels = target_levels))
  if (any(type_counts != 2)) {
    add_issue(
      "two_questions_per_type",
      paste(names(type_counts), as.integer(type_counts), sep = "=", collapse = "; "),
      participant_id = participant_id, paper_id = paper_id
    )
  }
  test_orders <- unique(rows$paper_order[!is.na(rows$paper_order)])
  if (length(test_orders) != 1) {
    add_issue(
      "test_paper_order", "paper_order is not unique within this test.",
      participant_id = participant_id, paper_id = paper_id
    )
  }
}

validation_checks <- data.frame(
  check = c(
    "required_columns", "two_tests_per_participant",
    "eight_questions_per_test", "unique_original_positions",
    "two_questions_per_type", "first_paper_order", "test_paper_order",
    "participant_field", "mutually_exclusive_status",
    "structural_zero_score", "structural_zero_answer_length",
    "parse_and_required_measurements"
  ),
  passed = c(
    TRUE,
    !any(issues$check == "two_tests_per_participant"),
    !any(issues$check == "eight_questions_per_test"),
    !any(issues$check == "unique_original_positions"),
    !any(issues$check == "two_questions_per_type"),
    !any(issues$check == "first_paper_order"),
    !any(issues$check == "test_paper_order"),
    !any(issues$check == "participant_field"),
    !any(issues$check == "mutually_exclusive_status"),
    !any(issues$check == "structural_zero_score"),
    !any(issues$check == "structural_zero_answer_length"),
    !any(issues$check %in% c(
      "boolean_parse", "numeric_parse", "participant_id", "paper_order",
      "field_type", "paper_position", "position", "question_target",
      "missing_measurement", "duration_range", "score_range"
    ))
  ),
  details = c(
    "All required columns found.",
    "Exactly paper positions 1 and 2 per participant.",
    "Exactly eight rows per test.",
    "Original positions are exactly 1-8.",
    "Exactly two questions of every required type.",
    "Exactly one position-1 paper_order per participant.",
    "paper_order is unique within each test.",
    "Exactly one field stratum per participant.",
    "No row is both skipped and timed out.",
    "Skipped and timed-out scores are zero.",
    "Skipped and timed-out free responses have zero length.",
    "All required values parse and measurements are present."
  ),
  stringsAsFactors = FALSE
)
write_validation_outputs(validation_checks)
if (nrow(issues) > 0) {
  jsonlite::write_json(
    list(
      status = "validation_failed",
      issue_count = nrow(issues),
      validation_checks = validation_checks
    ),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE, na = "null"
  )
  stop(
    "Hard validation failed; diagnostics were written and the model was not fit.",
    call. = FALSE
  )
}

first_paper <- data %>%
  filter(paper_position == 1L) %>%
  distinct(participant_id, first_paper_type = paper_order)
participant_field <- data %>%
  distinct(participant_id, field = field_type)

canonical_long <- data %>%
  mutate(question_target = factor(question_target, levels = target_levels)) %>%
  arrange(participant_id, paper_position, question_target, position) %>%
  group_by(participant_id, paper_position, question_target) %>%
  mutate(within_type_position = row_number()) %>%
  ungroup() %>%
  left_join(
    canonical_mapping,
    by = c(
      "question_target" = "question_type",
      "within_type_position" = "within_type_position"
    )
  ) %>%
  left_join(first_paper, by = "participant_id") %>%
  left_join(participant_field, by = "participant_id") %>%
  mutate(
    paper_id = paper_position,
    Authorship = ifelse(
      (paper_position == 1L & first_paper_type == "own") |
        (paper_position == 2L & first_paper_type == "foreign"),
      1L, 0L
    ),
    question_type = as.character(question_target),
    question_key = target_keys[match(question_type, target_levels)]
  )

observed_mapping <- canonical_long %>%
  transmute(
    participant_id, paper_id, canonical_question, question_type,
    within_type_position, original_position = position, input_row
  ) %>%
  arrange(participant_id, paper_id, canonical_question)
data.table::fwrite(
  observed_mapping,
  file.path(output_dir, "observed_question_mapping.csv")
)

type_features <- canonical_long %>%
  group_by(
    participant_id, paper_id, Authorship, field, question_key
  ) %>%
  summarise(
    completed_count = sum(completed),
    mean_duration = ifelse(
      completed_count == 0L, 0, mean(duration_ms[completed])
    ),
    mean_score = ifelse(
      completed_count == 0L, 0, mean(score[completed])
    ),
    .groups = "drop"
  )

test_totals <- canonical_long %>%
  group_by(participant_id, paper_id, Authorship, field) %>%
  summarise(
    timeout_count = sum(timed_out == 1L),
    total_skipped_count = sum(skipped == 1L),
    .groups = "drop"
  )

test_level_data <- type_features %>%
  pivot_wider(
    id_cols = c(participant_id, paper_id, Authorship, field),
    names_from = question_key,
    values_from = c(
      completed_count, mean_duration, mean_score
    ),
    names_glue = "{question_key}_{.value}"
  ) %>%
  left_join(
    test_totals,
    by = c("participant_id", "paper_id", "Authorship", "field")
  ) %>%
  mutate(field = factor(field, levels = c("in_field", "out_field"))) %>%
  arrange(participant_id, paper_id)

model_features <- c(
  "timeout_count",
  "total_skipped_count",
  paste0(target_keys, "_mean_duration"),
  paste0(target_keys, "_mean_score")
)

test_validation_issues <- data.frame(
  participant_id = character(), paper_id = integer(),
  issue = character(), stringsAsFactors = FALSE
)
add_test_validation_issue <- function(rows, issue) {
  test_validation_issues <<- bind_rows(
    test_validation_issues,
    rows %>%
      transmute(
        participant_id = as.character(participant_id),
        paper_id = as.integer(paper_id),
        issue = issue
      )
  )
}

duplicate_tests <- test_level_data %>%
  count(participant_id, paper_id) %>%
  filter(n != 1L)
if (nrow(duplicate_tests) > 0) {
  add_test_validation_issue(duplicate_tests, "Duplicate participant-paper row")
}
pair_checks <- test_level_data %>%
  group_by(participant_id) %>%
  summarise(
    test_rows = n(),
    own_tests = sum(Authorship == 1L),
    foreign_tests = sum(Authorship == 0L),
    valid = test_rows == 2L && own_tests == 1L && foreign_tests == 1L,
    .groups = "drop"
  )
bad_pairs <- pair_checks %>%
  filter(!valid) %>%
  transmute(participant_id, paper_id = NA_integer_)
if (nrow(bad_pairs) > 0) {
  add_test_validation_issue(bad_pairs, "Not exactly one own and one foreign test")
}
missing_model <- test_level_data %>%
  filter(if_any(all_of(model_features), is.na))
if (nrow(missing_model) > 0) {
  add_test_validation_issue(missing_model, "Missing model feature")
}
bad_counts <- test_level_data %>%
  filter(
    timeout_count < 0L | timeout_count > 8L |
      total_skipped_count < 0L | total_skipped_count > 8L |
      if_any(ends_with("_completed_count"), ~ .x < 0L | .x > 2L)
  )
if (nrow(bad_counts) > 0) {
  add_test_validation_issue(bad_counts, "Count outside expected range")
}
data.table::fwrite(
  test_validation_issues,
  file.path(output_dir, "invalid_aggregate_tests.csv")
)

aggregate_checks <- data.frame(
  check = c(
    "one_row_per_participant_paper", "one_own_one_foreign_per_participant",
    "no_missing_model_features", "aggregate_count_ranges"
  ),
  passed = c(
    nrow(duplicate_tests) == 0,
    nrow(bad_pairs) == 0,
    nrow(missing_model) == 0,
    nrow(bad_counts) == 0
  ),
  details = c(
    "Exactly one aggregate row per participant-paper.",
    "Exactly one own and one foreign row per participant.",
    "All 10 numeric model features are present.",
    "Timeout, skipped, and completed counts are in range."
  ),
  stringsAsFactors = FALSE
)
validation_checks <- bind_rows(validation_checks, aggregate_checks)
write_validation_outputs(validation_checks)
if (nrow(test_validation_issues) > 0) {
  jsonlite::write_json(
    list(status = "validation_failed", validation_checks = validation_checks),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE, na = "null"
  )
  stop(
    "Aggregate validation failed; diagnostics were written and the model was not fit.",
    call. = FALSE
  )
}

data.table::fwrite(
  test_level_data %>% mutate(field = as.character(field)),
  file.path(output_dir, "pooled_test_level_data.csv")
)

fixed_terms <- c("field", model_features)
fixed_formula <- stats::reformulate(fixed_terms, response = "Authorship")
model_formula_text <- paste(
  "Authorship ~",
  paste(fixed_terms, collapse = " + ")
)
model_formula <- stats::as.formula(model_formula_text)
writeLines(model_formula_text, file.path(output_dir, "model_formula.txt"))

model_variables <- c("Authorship", "field", model_features)
missingness <- data.frame(
  variable = model_variables,
  missing_count = vapply(
    model_variables,
    function(variable) sum(is.na(test_level_data[[variable]])),
    integer(1)
  ),
  stringsAsFactors = FALSE
)
data.table::fwrite(missingness, file.path(output_dir, "model_missingness.csv"))
complete_rows <- stats::complete.cases(test_level_data[, model_variables])
excluded_tests <- test_level_data[!complete_rows, c("participant_id", "paper_id")]
if (nrow(excluded_tests) > 0) {
  excluded_tests$missing_variables <- apply(
    test_level_data[!complete_rows, model_variables, drop = FALSE],
    1,
    function(row) paste(model_variables[is.na(row)], collapse = ";")
  )
}
data.table::fwrite(
  excluded_tests,
  file.path(output_dir, "excluded_model_tests.csv")
)
model_data <- test_level_data[complete_rows, , drop = FALSE]
scaling_parameters <- data.frame(
  feature = model_features,
  mean = vapply(
    model_features, function(feature) mean(model_data[[feature]]), numeric(1)
  ),
  standard_deviation = vapply(
    model_features, function(feature) stats::sd(model_data[[feature]]), numeric(1)
  ),
  stringsAsFactors = FALSE
)
data.table::fwrite(
  scaling_parameters,
  file.path(output_dir, "scaling_parameters.csv")
)
model_fit_data <- model_data
for (feature in model_features) {
  feature_sd <- scaling_parameters$standard_deviation[
    scaling_parameters$feature == feature
  ]
  if (!is.na(feature_sd) && feature_sd > 0) {
    feature_mean <- scaling_parameters$mean[
      scaling_parameters$feature == feature
    ]
    model_fit_data[[feature]] <- (
      model_fit_data[[feature]] - feature_mean
    ) / feature_sd
  }
}

participant_checks <- model_data %>%
  group_by(participant_id) %>%
  summarise(
    test_rows = n(),
    own_tests = sum(Authorship == 1L),
    foreign_tests = sum(Authorship == 0L),
    complete_pair = test_rows == 2L && own_tests == 1L && foreign_tests == 1L,
    .groups = "drop"
  )
data.table::fwrite(
  participant_checks,
  file.path(output_dir, "complete_case_participant_checks.csv")
)
incomplete_complete_case_participants <- sum(!participant_checks$complete_pair)
has_both_classes <- n_distinct(model_data$Authorship) == 2L
field_levels_present <- n_distinct(model_data$field, na.rm = TRUE)

predictor_variance <- data.frame(
  variable = model_features,
  unique_values = vapply(
    model_features,
    function(variable) n_distinct(model_data[[variable]], na.rm = TRUE),
    integer(1)
  ),
  variance = vapply(
    model_features,
    function(variable) stats::var(model_data[[variable]]),
    numeric(1)
  ),
  stringsAsFactors = FALSE
) %>%
  mutate(
    zero_variance = unique_values <= 1L,
    near_zero_variance = zero_variance | variance < 1e-8
  )
data.table::fwrite(
  predictor_variance,
  file.path(output_dir, "predictor_variance.csv")
)

sample_counts <- bind_rows(
  data.frame(
    scope = "overall", field = "all", Authorship = c(0L, 1L),
    count = as.integer(table(factor(
      model_data$Authorship, levels = c(0L, 1L)
    ))),
    stringsAsFactors = FALSE
  ),
  model_data %>%
    mutate(field = as.character(field)) %>%
    count(field, Authorship, name = "count") %>%
    mutate(scope = "by_field") %>%
    select(scope, field, Authorship, count)
)
data.table::fwrite(
  sample_counts,
  file.path(output_dir, "authorship_class_counts.csv")
)

model_matrix <- tryCatch(
  stats::model.matrix(fixed_formula, data = model_fit_data),
  error = function(error) error
)
matrix_error <- inherits(model_matrix, "error")
if (matrix_error) {
  matrix_diagnostics <- data.frame(
    column = character(), variance = numeric(),
    zero_variance = logical(), near_zero_variance = logical()
  )
  aliased_terms <- data.frame(
    term = character(), reason = character(), stringsAsFactors = FALSE
  )
  nominal_fixed_coefficients <- NA_integer_
  matrix_rank <- NA_integer_
} else {
  matrix_variance <- apply(model_matrix, 2, stats::var)
  matrix_diagnostics <- data.frame(
    column = colnames(model_matrix),
    variance = as.numeric(matrix_variance),
    zero_variance = as.numeric(matrix_variance) == 0,
    near_zero_variance = as.numeric(matrix_variance) < 1e-8,
    stringsAsFactors = FALSE
  )
  matrix_qr <- qr(model_matrix)
  nominal_fixed_coefficients <- ncol(model_matrix)
  matrix_rank <- matrix_qr$rank
  if (matrix_rank < nominal_fixed_coefficients) {
    aliased_terms <- data.frame(
      term = colnames(model_matrix)[
        matrix_qr$pivot[(matrix_rank + 1L):nominal_fixed_coefficients]
      ],
      reason = "Linearly dependent fixed-effect model-matrix column",
      stringsAsFactors = FALSE
    )
  } else {
    aliased_terms <- data.frame(
      term = character(), reason = character(), stringsAsFactors = FALSE
    )
  }
}
data.table::fwrite(
  matrix_diagnostics,
  file.path(output_dir, "model_matrix_diagnostics.csv")
)
data.table::fwrite(aliased_terms, file.path(output_dir, "aliased_terms.csv"))

separation_status <- "not_run"
separation_details <- ""
if (!matrix_error && nrow(model_data) > 0) {
  separation_fit <- tryCatch(
    stats::glm(
      fixed_formula,
      data = model_fit_data,
      family = stats::binomial(),
      method = detectseparation::detect_separation
    ),
    error = function(error) error
  )
  if (inherits(separation_fit, "error")) {
    separation_status <- "diagnostic_failed"
    separation_details <- conditionMessage(separation_fit)
  } else {
    separation_coefficients <- stats::coef(separation_fit)
    separated <- any(is.infinite(separation_coefficients))
    separation_status <- if (separated) "separation_detected" else "not_detected"
    separation_details <- paste(
      names(separation_coefficients)[is.infinite(separation_coefficients)],
      collapse = ";"
    )
  }
}

high_dimensional_warning <- !matrix_error &&
  nrow(model_data) <= nominal_fixed_coefficients + 2L
fit_warnings <- character()
fit_messages <- character()
fit_error <- NULL
model <- NULL
pre_fit_blocker <- matrix_error ||
  nrow(model_data) == 0 ||
  !has_both_classes ||
  (!matrix_error && matrix_rank < nominal_fixed_coefficients) ||
  separation_status == "separation_detected"
if (pre_fit_blocker) {
  fit_error <- if (matrix_error) {
    paste("Fixed-effect model matrix failed:", conditionMessage(model_matrix))
  } else if (nrow(model_data) == 0) {
    "No complete test rows are available."
  } else if (!has_both_classes) {
    "Complete-case data do not contain both Authorship classes."
  } else if (matrix_rank < nominal_fixed_coefficients) {
    paste0(
      "Reduced fixed-effect design is rank deficient (rank ", matrix_rank,
      " of ", nominal_fixed_coefficients, ")."
    )
  } else {
    "Fixed-effects separation was detected; logistic regression was not run."
  }
} else {
  model <- tryCatch(
    withCallingHandlers(
      stats::glm(
        formula = model_formula,
        data = model_fit_data,
        family = stats::binomial(),
        na.action = stats::na.fail
      ),
      warning = function(warning) {
        fit_warnings <<- c(fit_warnings, conditionMessage(warning))
        invokeRestart("muffleWarning")
      },
      message = function(message) {
        fit_messages <<- c(fit_messages, conditionMessage(message))
        invokeRestart("muffleMessage")
      }
    ),
    error = function(error) {
      fit_error <<- conditionMessage(error)
      NULL
    }
  )
}

empty_fixed_effects <- function() {
  data.frame(
    term = character(), estimate = numeric(), std.error = numeric(),
    statistic = numeric(), p.value = numeric(), conf.low = numeric(),
    conf.high = numeric(), odds_ratio = numeric(), odds_ratio_low = numeric(),
    odds_ratio_high = numeric(), stringsAsFactors = FALSE
  )
}

if (is.null(model)) {
  model_status <- "fit_failed"
  fixed_effects <- empty_fixed_effects()
  observations_used <- 0L
  actual_fixed_coefficients <- 0L
  finite_coefficients <- FALSE
  finite_covariance <- FALSE
  cluster_count <- n_distinct(model_data$participant_id)
  cluster_degrees_of_freedom <- max(cluster_count - 1L, 0L)
  glm_converged <- FALSE
  glm_iterations <- NA_integer_
  clustered_test <- NULL
} else {
  cluster_count <- n_distinct(model_data$participant_id)
  cluster_degrees_of_freedom <- cluster_count - 1L
  robust_error <- NULL
  cluster_vcov <- tryCatch(
    sandwich::vcovCL(
      model,
      cluster = model_data$participant_id,
      type = "HC1",
      cadjust = TRUE
    ),
    error = function(error) {
      robust_error <<- conditionMessage(error)
      NULL
    }
  )
  if (is.null(cluster_vcov)) {
    fit_warnings <- c(
      fit_warnings,
      paste("Cluster-robust covariance estimation failed:", robust_error)
    )
    clustered_test <- NULL
    fixed_effects <- empty_fixed_effects()
  } else {
    clustered_test <- lmtest::coeftest(
      model,
      vcov. = cluster_vcov,
      df = cluster_degrees_of_freedom
    )
    critical_value <- stats::qt(
      0.975, df = cluster_degrees_of_freedom
    )
    estimates <- as.numeric(clustered_test[, 1])
    standard_errors <- as.numeric(clustered_test[, 2])
    confidence_low <- estimates - critical_value * standard_errors
    confidence_high <- estimates + critical_value * standard_errors
    fixed_effects <- data.frame(
      term = rownames(clustered_test),
      estimate = estimates,
      std.error = standard_errors,
      statistic = as.numeric(clustered_test[, 3]),
      p.value = as.numeric(clustered_test[, 4]),
      conf.low = confidence_low,
      conf.high = confidence_high,
      odds_ratio = exp(estimates),
      odds_ratio_low = exp(confidence_low),
      odds_ratio_high = exp(confidence_high),
      stringsAsFactors = FALSE
    )
  }
  observations_used <- stats::nobs(model)
  actual_fixed_coefficients <- length(stats::coef(model))
  finite_coefficients <- all(is.finite(stats::coef(model)))
  finite_covariance <- !is.null(cluster_vcov) &&
    all(is.finite(as.matrix(cluster_vcov)))
  glm_converged <- isTRUE(model$converged)
  glm_iterations <- model$iter
  fit_has_warning <- (
    !glm_converged ||
      length(fit_warnings) > 0 ||
      separation_status == "diagnostic_failed" ||
      !finite_coefficients ||
      !finite_covariance ||
      high_dimensional_warning ||
      incomplete_complete_case_participants > 0
  )
  model_status <- if (fit_has_warning) {
    "fit_completed_with_warnings"
  } else {
    "fit_completed"
  }
}

summary_lines <- if (is.null(model)) {
  c("MODEL UNAVAILABLE", fit_error, fit_warnings, fit_messages)
} else {
  c(
    capture.output(summary(model)),
    "",
    paste0(
      "Participant-clustered robust coefficient tests (df = ",
      cluster_degrees_of_freedom, "):"
    ),
    if (is.null(clustered_test)) {
      "UNAVAILABLE"
    } else {
      capture.output(print(clustered_test))
    },
    "", "Captured warnings:", fit_warnings,
    "", "Captured messages:", fit_messages
  )
}
writeLines(summary_lines, file.path(output_dir, "model_summary.txt"))
data.table::fwrite(fixed_effects, file.path(output_dir, "fixed_effects.csv"))

diagnostics <- data.frame(
  diagnostic = c(
    "model_status", "test_level_observations", "participants",
    "complete_case_observations", "excluded_test_rows",
    "incomplete_complete_case_participants", "complete_case_has_both_classes",
    "complete_case_field_levels", "nominal_fixed_coefficients",
    "fixed_effect_matrix_rank", "actual_fixed_coefficients",
    "high_dimensional_warning", "separation_screen", "separation_details",
    "cluster_count", "cluster_degrees_of_freedom",
    "cluster_covariance_type", "cluster_finite_sample_adjustment",
    "glm_converged", "glm_iterations",
    "captured_warnings", "captured_messages",
    "finite_coefficients", "finite_covariance", "observations_used", "fit_error"
  ),
  value = c(
    model_status, nrow(test_level_data), n_distinct(test_level_data$participant_id),
    nrow(model_data), nrow(excluded_tests),
    incomplete_complete_case_participants, has_both_classes,
    field_levels_present, nominal_fixed_coefficients, matrix_rank,
    actual_fixed_coefficients, high_dimensional_warning,
    separation_status, separation_details, cluster_count,
    cluster_degrees_of_freedom, "HC1", TRUE, glm_converged, glm_iterations,
    paste(fit_warnings, collapse = " | "),
    paste(fit_messages, collapse = " | "),
    finite_coefficients, finite_covariance, observations_used,
    ifelse(is.null(fit_error), "", fit_error)
  ),
  stringsAsFactors = FALSE
)
data.table::fwrite(diagnostics, file.path(output_dir, "model_diagnostics.csv"))

feature_dictionary <- data.frame(
  feature = model_features,
  description = c(
    "Total timed-out questions across all eight questions",
    "Total skipped questions across all eight questions",
    paste("Completed", target_levels, "mean duration (ms)"),
    paste("Completed", target_levels, "mean score")
  ),
  stringsAsFactors = FALSE
)
data.table::fwrite(
  feature_dictionary,
  file.path(output_dir, "feature_dictionary.csv")
)

writeLines(
  knitr::kable(
    feature_dictionary,
    format = "latex", booktabs = TRUE,
    caption = "Pooled logistic-regression feature definitions",
    col.names = c("Feature", "Definition")
  ),
  file.path(latex_dir, "feature_dictionary.tex")
)
writeLines(
  knitr::kable(
    sample_counts,
    format = "latex", booktabs = TRUE,
    caption = "Authorship class counts overall and by field",
    col.names = c("Scope", "Field", "Authorship", "Count")
  ),
  file.path(latex_dir, "sample_counts.tex")
)
if (nrow(fixed_effects) > 0) {
  significance_stars <- ifelse(
    fixed_effects$p.value < 0.001, "***",
    ifelse(
      fixed_effects$p.value < 0.01, "**",
      ifelse(fixed_effects$p.value < 0.05, "*", "")
    )
  )
  bold_if_significant <- function(values) {
    ifelse(
      fixed_effects$p.value < 0.05,
      paste0("\\textbf{", values, "}"),
      values
    )
  }
  fixed_for_latex <- fixed_effects %>%
    transmute(
      Term = gsub("_", "\\\\_", term, fixed = TRUE),
      Estimate = bold_if_significant(
        paste0(sprintf("%.3f", estimate), significance_stars)
      ),
      `Std. error` = round(std.error, 3),
      `p-value` = bold_if_significant(sprintf("%.3f", p.value)),
      `Odds ratio` = bold_if_significant(sprintf("%.3f", odds_ratio)),
      `95\\% OR CI` = bold_if_significant(
        sprintf("[%.3f, %.3f]", odds_ratio_low, odds_ratio_high)
      )
    )
} else {
  fixed_for_latex <- data.frame(
    Result = "Model unavailable; see model\\_diagnostics.csv.",
    stringsAsFactors = FALSE
  )
}
fixed_latex_table <- knitr::kable(
  fixed_for_latex,
  format = "latex", booktabs = TRUE, escape = FALSE,
  caption = "Pooled logistic regression with participant-clustered standard errors",
  longtable = TRUE
)
if (nrow(fixed_effects) > 0) {
  fixed_latex_table <- c(
    fixed_latex_table,
    paste0(
      "\\noindent\\footnotesize\\textit{Note:} Bold values are statistically ",
      "significant. *** $p<0.001$; ** $p<0.01$; * $p<0.05$.\\normalsize"
    )
  )
}
writeLines(
  fixed_latex_table,
  file.path(latex_dir, "fixed_effects.tex")
)
diagnostics_for_latex <- diagnostics %>%
  filter(diagnostic %in% c(
    "model_status", "test_level_observations", "participants",
    "nominal_fixed_coefficients", "fixed_effect_matrix_rank",
    "actual_fixed_coefficients", "separation_screen", "cluster_count",
    "cluster_degrees_of_freedom", "cluster_covariance_type",
    "cluster_finite_sample_adjustment", "glm_converged", "glm_iterations",
    "finite_coefficients", "finite_covariance", "observations_used"
  ))
writeLines(
  knitr::kable(
    diagnostics_for_latex,
    format = "latex", booktabs = TRUE,
    caption = "Pooled clustered-logistic model diagnostics",
    col.names = c("Diagnostic", "Value")
  ),
  file.path(latex_dir, "model_diagnostics.tex")
)
writeLines(
  c(
    "% Required packages: booktabs and longtable",
    "\\input{latex/feature_dictionary.tex}",
    "\\input{latex/sample_counts.tex}",
    "\\input{latex/fixed_effects.tex}",
    "\\input{latex/model_diagnostics.tex}"
  ),
  file.path(latex_dir, "all_tables.tex")
)

summary_payload <- list(
  status = model_status,
  formula = model_formula_text,
  validation_checks = validation_checks,
  test_level_observations = nrow(test_level_data),
  participants = n_distinct(test_level_data$participant_id),
  observations_used = observations_used,
  excluded_test_rows = nrow(excluded_tests),
  nominal_fixed_coefficients = nominal_fixed_coefficients,
  fixed_effect_matrix_rank = matrix_rank,
  actual_fixed_coefficients = actual_fixed_coefficients,
  high_dimensional_warning = high_dimensional_warning,
  separation_screen = list(
    status = separation_status,
    details = separation_details,
    note = "Fixed-effects-only diagnostic; random effect is not represented."
  ),
  cluster_count = cluster_count,
  cluster_degrees_of_freedom = cluster_degrees_of_freedom,
  cluster_covariance_type = "HC1",
  cluster_finite_sample_adjustment = TRUE,
  glm_converged = glm_converged,
  glm_iterations = glm_iterations,
  captured_warnings = fit_warnings,
  captured_messages = fit_messages,
  finite_coefficients = finite_coefficients,
  finite_covariance = finite_covariance,
  fit_error = fit_error
)
jsonlite::write_json(
  summary_payload,
  file.path(output_dir, "analysis_summary.json"),
  pretty = TRUE, auto_unbox = TRUE, na = "null"
)

message(
  "Pooled clustered-logistic workflow complete. Status: ", model_status,
  ". Results: ", normalizePath(output_dir, mustWork = TRUE)
)
