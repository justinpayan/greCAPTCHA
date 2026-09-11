#!/usr/bin/env Rscript

# Build canonical Q1-Q8 test rows and fit the prespecified authorship GLMM.
# The source file is read locally and is never modified.

required_packages <- c(
  "data.table", "dplyr", "tidyr", "lme4", "broom.mixed", "jsonlite",
  "detectseparation", "knitr"
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
    "Usage: Rscript scripts/analysis/analyze_mixed_effects.R ",
    "<private.csv-or-tsv> [output-directory]",
    call. = FALSE
  )
}

input_path <- normalizePath(args[[1]], mustWork = TRUE)
output_dir <- if (length(args) == 2) args[[2]] else "mixed_effects_output"
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
  issues <<- dplyr::bind_rows(
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

normalize_text <- function(x) {
  tolower(trimws(gsub("\\s+", " ", as.character(x))))
}

parse_boolean <- function(x, column, input_rows) {
  normalized <- normalize_text(x)
  values <- ifelse(
    normalized %in% c("true", "1", "yes"), 1L,
    ifelse(normalized %in% c("false", "0", "no"), 0L, NA_integer_)
  )
  bad <- which(is.na(values))
  for (index in bad) {
    add_issue(
      "boolean_parse",
      sprintf("Invalid %s value '%s'.", column, x[[index]]),
      input_row = input_rows[[index]]
    )
  }
  values
}

parse_numeric <- function(x, column, input_rows, integer_only = FALSE) {
  value <- suppressWarnings(as.numeric(trimws(as.character(x))))
  bad <- which(is.na(value) & !is.na(x))
  bad <- union(bad, which(trimws(as.character(x)) == ""))
  if (integer_only) {
    bad <- union(bad, which(!is.na(value) & abs(value - round(value)) > 1e-9))
  }
  for (index in sort(unique(bad))) {
    add_issue(
      "numeric_parse",
      sprintf("Missing or invalid %s value '%s'.", column, x[[index]]),
      input_row = input_rows[[index]]
    )
  }
  if (integer_only) as.integer(round(value)) else value
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
    paste(
      "Duplicate column names after case/whitespace normalization:",
      paste(duplicate_names, collapse = ", ")
    )
  )
  checks <- data.frame(
    check = "unique_normalized_columns",
    passed = FALSE,
    details = paste(duplicate_names, collapse = ", "),
    stringsAsFactors = FALSE
  )
  write_validation_outputs(checks)
  jsonlite::write_json(
    list(status = "validation_failed", duplicate_columns = duplicate_names),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE
  )
  stop("Duplicate normalized columns; see validation outputs.", call. = FALSE)
}
names(raw) <- normalized_names
missing_columns <- setdiff(required_columns, names(raw))
if (length(missing_columns) > 0) {
  add_issue(
    "required_columns",
    paste("Missing columns:", paste(missing_columns, collapse = ", "))
  )
  checks <- data.frame(
    check = "required_columns",
    passed = FALSE,
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

for (index in which(data$participant_id == "" | is.na(data$participant_id))) {
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

both_status <- which(data$skipped == 1L & data$timed_out == 1L)
for (index in both_status) {
  add_issue(
    "mutually_exclusive_status",
    "skipped and timed_out are both true.",
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
    raw_answer_length = ifelse(
      is.na(response), NA_integer_, nchar(enc2utf8(response), type = "chars")
    ),
    is_free_response = question_target %in% free_response_targets,
    answer_length = case_when(
      is_free_response & status %in% c("skipped", "timed_out") ~ 0,
      is_free_response & status == "completed" ~ as.numeric(raw_answer_length),
      TRUE ~ NA_real_
    )
  )

missing_measurements <- which(is.na(data$score) | is.na(data$duration_ms))
for (index in missing_measurements) {
  add_issue(
    "missing_measurement", "score or duration_ms is missing.",
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
zero_score_violation <- which(
  data$status %in% c("skipped", "timed_out") &
    !is.na(data$score) & data$score != 0
)
for (index in zero_score_violation) {
  add_issue(
    "structural_zero_score",
    sprintf("%s question has nonzero score.", data$status[[index]]),
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}
answer_zero_violation <- which(
  data$is_free_response &
    data$status %in% c("skipped", "timed_out") &
    !is.na(data$raw_answer_length) & data$raw_answer_length != 0
)
for (index in answer_zero_violation) {
  add_issue(
    "structural_zero_answer_length",
    sprintf("%s free-response question has nonempty response.", data$status[[index]]),
    data$input_row[[index]], data$participant_id[[index]],
    data$paper_position[[index]]
  )
}

participant_groups <- split(data, data$participant_id, drop = TRUE)
for (participant_id in names(participant_groups)) {
  participant_rows <- participant_groups[[participant_id]]
  observed_papers <- sort(unique(participant_rows$paper_position))
  if (
    length(observed_papers) != 2 ||
      !identical(observed_papers, c(1L, 2L))
  ) {
    add_issue(
      "two_tests_per_participant",
      sprintf(
        "Expected paper positions 1 and 2; found %s.",
        paste(observed_papers, collapse = ", ")
      ),
      participant_id = participant_id
    )
  }
  first_orders <- unique(
    participant_rows$paper_order[participant_rows$paper_position == 1L]
  )
  first_orders <- first_orders[!is.na(first_orders)]
  if (length(first_orders) != 1) {
    add_issue(
      "first_paper_order",
      "Position-1 rows do not define exactly one paper_order.",
      participant_id = participant_id
    )
  }
  fields <- unique(participant_rows$field_type[!is.na(participant_rows$field_type)])
  if (length(fields) != 1) {
    add_issue(
      "participant_field",
      "Foreign-paper field stratum is not unique within participant.",
      participant_id = participant_id
    )
  }
}

test_key <- interaction(
  data$participant_id, data$paper_position, drop = TRUE, lex.order = TRUE
)
test_groups <- split(data, test_key, drop = TRUE)
for (test_rows in test_groups) {
  participant_id <- test_rows$participant_id[[1]]
  paper_id <- test_rows$paper_position[[1]]
  if (nrow(test_rows) != 8) {
    add_issue(
      "eight_questions_per_test",
      sprintf("Expected 8 questions; found %d.", nrow(test_rows)),
      participant_id = participant_id, paper_id = paper_id
    )
  }
  positions <- sort(test_rows$position)
  if (
    length(positions) != 8 ||
      any(is.na(positions)) ||
      !identical(positions, 1:8)
  ) {
    add_issue(
      "unique_original_positions",
      sprintf("Expected original positions 1-8; found %s.", paste(positions, collapse = ", ")),
      participant_id = participant_id, paper_id = paper_id
    )
  }
  type_counts <- table(factor(test_rows$question_target, levels = target_levels))
  if (any(type_counts != 2)) {
    add_issue(
      "two_questions_per_type",
      paste(
        names(type_counts), as.integer(type_counts),
        sep = "=", collapse = "; "
      ),
      participant_id = participant_id, paper_id = paper_id
    )
  }
  test_orders <- unique(test_rows$paper_order[!is.na(test_rows$paper_order)])
  if (length(test_orders) != 1) {
    add_issue(
      "test_paper_order",
      "paper_order is not uniquely defined within this test.",
      participant_id = participant_id, paper_id = paper_id
    )
  }
}

validation_checks <- data.frame(
  check = c(
    "required_columns", "two_tests_per_participant",
    "eight_questions_per_test", "unique_original_positions",
    "two_questions_per_type", "first_paper_order", "test_paper_order",
    "participant_field",
    "canonical_mapping_specification",
    "mutually_exclusive_status", "structural_zero_score",
    "structural_zero_answer_length",
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
    identical(
      canonical_mapping$canonical_question, paste0("q", 1:8)
    ) && identical(
      canonical_mapping$question_type, rep(target_levels, each = 2)
    ),
    !any(issues$check == "mutually_exclusive_status"),
    !any(issues$check == "structural_zero_score"),
    !any(issues$check == "structural_zero_answer_length"),
    !any(issues$check %in% c(
      "boolean_parse", "numeric_parse", "participant_id", "paper_order",
      "field_type", "paper_position", "position", "question_target",
      "missing_measurement"
    ))
  ),
  details = c(
    "All required columns found.",
    "Exactly paper positions 1 and 2 per participant.",
    "Exactly eight rows per participant-paper test.",
    "Original positions are exactly 1-8.",
    "Exactly two questions of every required type.",
    "Exactly one position-1 paper_order per participant.",
    "paper_order is uniquely defined within each test.",
    "Exactly one foreign-paper field stratum per participant.",
    "Q1-Q8 match the prespecified type and within-type order.",
    "No row is both skipped and timed out.",
    "Skipped and timed-out scores are zero.",
    "Skipped and timed-out free responses have zero length.",
    "All required values parse and required measurements are present."
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
  mutate(
    question_target = factor(question_target, levels = target_levels)
  ) %>%
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
    duration = duration_ms
  )

observed_mapping <- canonical_long %>%
  transmute(
    participant_id, paper_id, canonical_question,
    question_type = as.character(question_target),
    within_type_position, original_position = position, input_row
  ) %>%
  arrange(participant_id, paper_id, canonical_question)
data.table::fwrite(
  observed_mapping,
  file.path(output_dir, "observed_question_mapping.csv")
)

test_level_data <- canonical_long %>%
  select(
    participant_id, paper_id, Authorship, field, canonical_question,
    status, score, duration, skipped, answer_length
  ) %>%
  pivot_wider(
    id_cols = c(participant_id, paper_id, Authorship, field),
    names_from = canonical_question,
    values_from = c(status, score, duration, skipped, answer_length),
    names_glue = "{canonical_question}_{.value}"
  ) %>%
  select(-q1_answer_length, -q2_answer_length) %>%
  mutate(
    field = factor(field, levels = c("in_field", "out_field")),
    across(
      matches("^q[1-8]_status$"),
      ~ factor(.x, levels = c("completed", "skipped", "timed_out"))
    )
  ) %>%
  arrange(participant_id, paper_id)

postreshape_counts <- test_level_data %>%
  count(participant_id, name = "test_rows")
one_row_per_test <- anyDuplicated(
  test_level_data[c("participant_id", "paper_id")]
) == 0
two_rows_per_participant <- all(postreshape_counts$test_rows == 2L)
authorship_pairs_valid <- test_level_data %>%
  group_by(participant_id) %>%
  summarise(
    valid = n() == 2L &&
      sum(Authorship == 0L) == 1L &&
      sum(Authorship == 1L) == 1L,
    .groups = "drop"
  ) %>%
  pull(valid) %>%
  all()
observed_mapping_valid <- observed_mapping %>%
  group_by(participant_id, paper_id) %>%
  summarise(
    valid = identical(sort(canonical_question), paste0("q", 1:8)),
    .groups = "drop"
  ) %>%
  pull(valid) %>%
  all()
validation_checks <- bind_rows(
  validation_checks,
  data.frame(
    check = c(
      "one_row_per_participant_paper",
      "two_wide_rows_per_participant",
      "one_own_and_one_foreign_per_participant",
      "observed_canonical_mapping"
    ),
    passed = c(
      one_row_per_test,
      two_rows_per_participant,
      authorship_pairs_valid,
      observed_mapping_valid
    ),
    details = c(
      "Exactly one wide row per participant-paper test.",
      "Exactly two wide test rows per participant.",
      "Every participant has exactly one own and one foreign test.",
      "Every test contains canonical questions Q1-Q8 exactly once."
    ),
    stringsAsFactors = FALSE
  )
)
write_validation_outputs(validation_checks)
if (
  !one_row_per_test ||
    !two_rows_per_participant ||
    !authorship_pairs_valid ||
    !observed_mapping_valid
) {
  add_issue(
    "postreshape_structure",
    "Wide-row uniqueness or canonical mapping validation failed."
  )
  write_validation_outputs(validation_checks)
  jsonlite::write_json(
    list(status = "validation_failed", validation_checks = validation_checks),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE, na = "null"
  )
  stop(
    "Post-reshape validation failed; diagnostics were written and model was not fit.",
    call. = FALSE
  )
}

data.table::fwrite(
  mutate(
    test_level_data,
    across(where(is.factor), as.character)
  ),
  file.path(output_dir, "test_level_data.csv")
)

question_terms <- unlist(lapply(1:8, function(index) {
  prefix <- paste0("q", index)
  terms <- c(
    paste0(prefix, "_status"),
    paste0(prefix, "_score")
  )
  if (index >= 3) {
    terms <- c(terms, paste0(prefix, "_answer_length"))
  }
  c(
    terms,
    paste0(prefix, "_duration"),
    paste0(prefix, "_skipped:", prefix, "_duration")
  )
}))
fixed_terms <- c("field", question_terms)
fixed_formula <- stats::reformulate(fixed_terms, response = "Authorship")
model_formula_text <- paste(
  "Authorship ~ (1 | participant_id) +",
  paste(fixed_terms, collapse = " + ")
)
model_formula <- stats::as.formula(model_formula_text)
writeLines(model_formula_text, file.path(output_dir, "model_formula.txt"))

model_variables <- unique(c(
  "Authorship", "field",
  unlist(lapply(1:8, function(index) {
    prefix <- paste0("q", index)
    variables <- c(
      paste0(prefix, "_status"), paste0(prefix, "_score"),
      paste0(prefix, "_duration"), paste0(prefix, "_skipped")
    )
    if (index >= 3) variables <- c(variables, paste0(prefix, "_answer_length"))
    variables
  }))
))
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
complete_case_participant_checks <- model_data %>%
  group_by(participant_id) %>%
  summarise(
    test_rows = n(),
    own_tests = sum(Authorship == 1L),
    foreign_tests = sum(Authorship == 0L),
    complete_pair = test_rows == 2L && own_tests == 1L && foreign_tests == 1L,
    .groups = "drop"
  )
data.table::fwrite(
  complete_case_participant_checks,
  file.path(output_dir, "complete_case_participant_checks.csv")
)
incomplete_complete_case_participants <- sum(
  !complete_case_participant_checks$complete_pair
)
complete_case_has_both_classes <- dplyr::n_distinct(model_data$Authorship) == 2L
complete_case_field_levels <- dplyr::n_distinct(model_data$field, na.rm = TRUE)

raw_variance <- data.frame(
  variable = setdiff(model_variables, c("Authorship", "field")),
  unique_values = vapply(
    setdiff(model_variables, c("Authorship", "field")),
    function(variable) dplyr::n_distinct(model_data[[variable]], na.rm = TRUE),
    integer(1)
  ),
  stringsAsFactors = FALSE
) %>%
  mutate(
    zero_variance = unique_values <= 1L,
    near_zero_variance = vapply(variable, function(variable_name) {
      value <- model_data[[variable_name]]
      if (is.factor(value) || is.character(value)) {
        counts <- sort(table(value), decreasing = TRUE)
        length(counts) <= 1L ||
          (length(counts) > 1L && counts[[1]] / counts[[2]] > 19)
      } else {
        stats::var(value) < 1e-8
      }
    }, logical(1))
  )
data.table::fwrite(raw_variance, file.path(output_dir, "predictor_variance.csv"))

sample_counts <- dplyr::bind_rows(
  data.frame(
    scope = "overall", field = "all",
    Authorship = c(0L, 1L),
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
data.table::fwrite(sample_counts, file.path(output_dir, "authorship_class_counts.csv"))

model_matrix <- tryCatch(
  stats::model.matrix(fixed_formula, data = model_data),
  error = function(error) error
)
matrix_error <- inherits(model_matrix, "error")
matrix_diagnostics <- if (matrix_error) {
  data.frame(
    column = NA_character_, variance = NA_real_,
    zero_variance = NA, near_zero_variance = NA,
    stringsAsFactors = FALSE
  )
} else {
  matrix_variances <- apply(model_matrix, 2, stats::var)
  data.frame(
    column = colnames(model_matrix),
    variance = as.numeric(matrix_variances),
    zero_variance = as.numeric(matrix_variances) == 0,
    near_zero_variance = as.numeric(matrix_variances) < 1e-8,
    stringsAsFactors = FALSE
  )
}
data.table::fwrite(
  matrix_diagnostics,
  file.path(output_dir, "model_matrix_diagnostics.csv")
)
if (matrix_error) {
  aliased_terms <- data.frame(
    term = character(), reason = character(), stringsAsFactors = FALSE
  )
} else {
  matrix_qr <- qr(model_matrix)
  if (matrix_qr$rank < ncol(model_matrix)) {
    aliased_columns <- colnames(model_matrix)[
      matrix_qr$pivot[(matrix_qr$rank + 1L):ncol(model_matrix)]
    ]
    aliased_terms <- data.frame(
      term = aliased_columns,
      reason = "Linearly dependent fixed-effect model-matrix column",
      stringsAsFactors = FALSE
    )
  } else {
    aliased_terms <- data.frame(
      term = character(), reason = character(), stringsAsFactors = FALSE
    )
  }
}
data.table::fwrite(aliased_terms, file.path(output_dir, "aliased_terms.csv"))

separation_status <- "not_run"
separation_details <- ""
if (!matrix_error && nrow(model_data) > 0) {
  separation_fit <- tryCatch(
    stats::glm(
      fixed_formula,
      data = model_data,
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

nominal_fixed_coefficients <- if (matrix_error) NA_integer_ else ncol(model_matrix)
matrix_rank <- if (matrix_error) NA_integer_ else qr(model_matrix)$rank
high_dimensional_warning <- !matrix_error &&
  nrow(model_data) <= nominal_fixed_coefficients + 2L

fit_warnings <- character()
fit_messages <- character()
fit_error <- NULL
model <- NULL
pre_fit_blocker <- matrix_error ||
  nrow(model_data) == 0 ||
  !complete_case_has_both_classes ||
  (!matrix_error && matrix_rank < nominal_fixed_coefficients) ||
  separation_status == "separation_detected"
if (pre_fit_blocker) {
  fit_error <- if (matrix_error) {
    paste("Fixed-effect model matrix failed:", conditionMessage(model_matrix))
  } else if (nrow(model_data) == 0) {
    "No complete test rows are available."
  } else if (!complete_case_has_both_classes) {
    "Complete-case data do not contain both Authorship classes."
  } else if (matrix_rank < nominal_fixed_coefficients) {
    paste0(
      "The requested fixed-effect design is rank deficient (rank ",
      matrix_rank, " of ", nominal_fixed_coefficients,
      "); glmer was not run because it would drop coefficients."
    )
  } else if (separation_status == "separation_detected") {
    "Fixed-effects separation was detected; the requested glmer model was not fit."
  } else {
    "A pre-fit diagnostic blocked estimation."
  }
} else {
  model <- tryCatch(
    withCallingHandlers(
      lme4::glmer(
        formula = model_formula,
        data = model_data,
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

if (is.null(model)) {
  writeLines(
    c("MODEL UNAVAILABLE", fit_error, fit_warnings, fit_messages),
    file.path(output_dir, "model_summary.txt")
  )
  fixed_effects <- data.frame(
    term = character(), estimate = numeric(), std.error = numeric(),
    statistic = numeric(), p.value = numeric(), conf.low = numeric(),
    conf.high = numeric(), odds_ratio = numeric(), odds_ratio_low = numeric(),
    odds_ratio_high = numeric(), stringsAsFactors = FALSE
  )
  singular_fit <- NA
  observations_used <- 0L
  actual_fixed_coefficients <- 0L
  random_intercept_variance <- NA_real_
  finite_coefficients <- FALSE
  finite_covariance <- FALSE
  maximum_absolute_gradient <- NA_real_
  minimum_hessian_eigenvalue <- NA_real_
  convergence_messages <- character()
  optimizer_code <- NA_integer_
  model_status <- "fit_failed"
} else {
  writeLines(
    c(
      capture.output(summary(model)),
      "", "Captured warnings:", fit_warnings,
      "", "Captured messages:", fit_messages
    ),
    file.path(output_dir, "model_summary.txt")
  )
  tidy_error <- NULL
  fixed_effects <- tryCatch(
    broom.mixed::tidy(
      model, effects = "fixed", conf.int = TRUE, conf.method = "Wald"
    ) %>%
      mutate(
        odds_ratio = exp(estimate),
        odds_ratio_low = exp(conf.low),
        odds_ratio_high = exp(conf.high)
      ),
    error = function(error) {
      tidy_error <<- conditionMessage(error)
      data.frame(
        term = character(), estimate = numeric(), std.error = numeric(),
        statistic = numeric(), p.value = numeric(), conf.low = numeric(),
        conf.high = numeric(), odds_ratio = numeric(),
        odds_ratio_low = numeric(), odds_ratio_high = numeric(),
        stringsAsFactors = FALSE
      )
    }
  )
  if (!is.null(tidy_error)) {
    fit_warnings <- c(
      fit_warnings,
      paste("Fixed-effect result extraction failed:", tidy_error)
    )
  }
  singular_fit <- lme4::isSingular(model)
  observations_used <- stats::nobs(model)
  actual_fixed_coefficients <- length(lme4::fixef(model))
  random_intercept_variance <- as.data.frame(lme4::VarCorr(model))$vcov[[1]]
  finite_coefficients <- all(is.finite(lme4::fixef(model)))
  finite_covariance <- tryCatch(
    all(is.finite(as.matrix(stats::vcov(model)))),
    error = function(error) {
      fit_warnings <<- c(
        fit_warnings,
        paste("Covariance extraction failed:", conditionMessage(error))
      )
      FALSE
    }
  )
  convergence_messages <- model@optinfo$conv$lme4$messages
  if (is.null(convergence_messages)) convergence_messages <- character()
  optimizer_code <- model@optinfo$conv$opt
  if (is.null(optimizer_code)) optimizer_code <- NA_integer_
  gradient <- model@optinfo$derivs$gradient
  maximum_absolute_gradient <- if (is.null(gradient)) {
    NA_real_
  } else {
    max(abs(gradient))
  }
  hessian <- model@optinfo$derivs$Hessian
  minimum_hessian_eigenvalue <- if (
    is.null(hessian) || any(!is.finite(hessian))
  ) {
    NA_real_
  } else {
    min(eigen(hessian, symmetric = TRUE, only.values = TRUE)$values)
  }
  convergence_problem <- (
    (!is.na(optimizer_code) && optimizer_code != 0L) ||
      length(convergence_messages) > 0 ||
      !finite_coefficients ||
      !finite_covariance ||
      isTRUE(singular_fit) ||
      length(fit_warnings) > 0 ||
      high_dimensional_warning ||
      incomplete_complete_case_participants > 0 ||
      (!is.na(maximum_absolute_gradient) && maximum_absolute_gradient > 0.002) ||
      (!is.na(minimum_hessian_eigenvalue) && minimum_hessian_eigenvalue <= 0)
  )
  model_status <- if (convergence_problem) {
    "fit_completed_with_warnings"
  } else {
    "fit_completed"
  }
}
data.table::fwrite(
  fixed_effects,
  file.path(output_dir, "fixed_effects.csv")
)

diagnostics <- data.frame(
  diagnostic = c(
    "model_status", "test_level_observations", "participants",
    "complete_case_observations", "excluded_test_rows",
    "nominal_fixed_coefficients", "fixed_effect_matrix_rank",
    "actual_fixed_coefficients", "high_dimensional_warning",
    "incomplete_complete_case_participants", "complete_case_has_both_classes",
    "complete_case_field_levels",
    "separation_screen", "separation_details",
    "singular_fit", "random_intercept_variance", "optimizer_code",
    "maximum_absolute_gradient", "minimum_hessian_eigenvalue",
    "convergence_messages", "captured_warnings", "captured_messages",
    "finite_coefficients", "finite_covariance", "observations_used",
    "fit_error"
  ),
  value = c(
    model_status, nrow(test_level_data),
    dplyr::n_distinct(test_level_data$participant_id), nrow(model_data),
    nrow(excluded_tests), nominal_fixed_coefficients, matrix_rank,
    actual_fixed_coefficients, high_dimensional_warning,
    incomplete_complete_case_participants, complete_case_has_both_classes,
    complete_case_field_levels,
    separation_status, separation_details, singular_fit,
    random_intercept_variance, optimizer_code,
    maximum_absolute_gradient, minimum_hessian_eigenvalue,
    paste(convergence_messages, collapse = " | "),
    paste(fit_warnings, collapse = " | "),
    paste(fit_messages, collapse = " | "),
    finite_coefficients, finite_covariance, observations_used,
    ifelse(is.null(fit_error), "", fit_error)
  ),
  stringsAsFactors = FALSE
)
data.table::fwrite(diagnostics, file.path(output_dir, "model_diagnostics.csv"))

latex_escape <- function(x) {
  x <- gsub("\\\\", "\\\\textbackslash{}", as.character(x), fixed = TRUE)
  x <- gsub("_", "\\\\_", x, fixed = TRUE)
  x <- gsub("%", "\\\\%", x, fixed = TRUE)
  x <- gsub("&", "\\\\&", x, fixed = TRUE)
  x <- gsub("#", "\\\\#", x, fixed = TRUE)
  x
}

writeLines(
  knitr::kable(
    canonical_mapping,
    format = "latex", booktabs = TRUE,
    caption = "Canonical question mapping",
    col.names = c("Canonical question", "Question type", "Within-type position")
  ),
  file.path(latex_dir, "canonical_question_mapping.tex")
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
      Term = latex_escape(term),
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
  caption = "Binomial mixed-effects model fixed effects",
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
    "complete_case_observations", "excluded_test_rows",
    "nominal_fixed_coefficients", "fixed_effect_matrix_rank",
    "actual_fixed_coefficients", "high_dimensional_warning",
    "incomplete_complete_case_participants",
    "complete_case_has_both_classes", "complete_case_field_levels",
    "separation_screen", "singular_fit", "random_intercept_variance",
    "optimizer_code", "maximum_absolute_gradient",
    "minimum_hessian_eigenvalue", "finite_coefficients",
    "finite_covariance", "observations_used"
  ))
writeLines(
  knitr::kable(
    diagnostics_for_latex,
    format = "latex", booktabs = TRUE,
    caption = "Mixed-effects model diagnostics",
    col.names = c("Diagnostic", "Value")
  ),
  file.path(latex_dir, "model_diagnostics.tex")
)
writeLines(
  c(
    "% Required packages: booktabs and longtable",
    "\\input{latex/canonical_question_mapping.tex}",
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
  participants = dplyr::n_distinct(test_level_data$participant_id),
  observations_used = observations_used,
  excluded_test_rows = nrow(excluded_tests),
  nominal_fixed_coefficients = nominal_fixed_coefficients,
  fixed_effect_matrix_rank = matrix_rank,
  actual_fixed_coefficients = actual_fixed_coefficients,
  high_dimensional_warning = high_dimensional_warning,
  incomplete_complete_case_participants = incomplete_complete_case_participants,
  complete_case_has_both_classes = complete_case_has_both_classes,
  complete_case_field_levels = complete_case_field_levels,
  separation_screen = list(
    status = separation_status,
    details = separation_details,
    note = "Fixed-effects-only diagnostic; random effect is not represented."
  ),
  singular_fit = singular_fit,
  random_intercept_variance = random_intercept_variance,
  optimizer_code = optimizer_code,
  maximum_absolute_gradient = maximum_absolute_gradient,
  minimum_hessian_eigenvalue = minimum_hessian_eigenvalue,
  convergence_messages = convergence_messages,
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
  "Mixed-effects workflow complete. Status: ", model_status,
  ". Results: ", normalizePath(output_dir, mustWork = TRUE)
)
