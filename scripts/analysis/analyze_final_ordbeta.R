#!/usr/bin/env Rscript

# Final question-level ordered-beta analysis.
# The input is read only; every generated artifact is written below output_dir.

required_packages <- c(
  "data.table", "dplyr", "tidyr", "ggplot2", "glmmTMB", "emmeans",
  "jsonlite", "knitr"
)
missing_packages <- required_packages[
  !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_packages) > 0L) {
  stop(
    "Missing R packages: ", paste(missing_packages, collapse = ", "),
    call. = FALSE
  )
}

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(ggplot2)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1L || length(args) > 2L) {
  stop(
    "Usage: Rscript scripts/analysis/analyze_final_ordbeta.R ",
    "<csv-or-tsv> [output-dir]",
    call. = FALSE
  )
}

input_path <- normalizePath(args[[1]], mustWork = FALSE)
output_dir <- if (length(args) == 2L) args[[2]] else "final_ordbeta_output"
latex_dir <- file.path(output_dir, "latex")
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(latex_dir, recursive = TRUE, showWarnings = FALSE)

required_columns <- c(
  "participant_id", "paper_order", "paper_position", "field_type",
  "question_target", "question_type", "score", "skipped", "timed_out",
  "position", "duration_ms", "attempt_score"
)
target_levels <- c(
  "Planted error", "Unstated rationale", "Background knowledge", "Failure mode"
)

issues <- data.frame(
  severity = character(), check = character(), input_row = integer(),
  participant_id = character(), paper_position = integer(),
  column = character(), value = character(), message = character(),
  stringsAsFactors = FALSE
)

add_issue <- function(
    severity, check, message, input_row = NA_integer_,
    participant_id = NA_character_, paper_position = NA_integer_,
    column = NA_character_, value = NA_character_) {
  issues <<- dplyr::bind_rows(
    issues,
    data.frame(
      severity = severity, check = check, input_row = as.integer(input_row),
      participant_id = as.character(participant_id),
      paper_position = as.integer(paper_position), column = as.character(column),
      value = as.character(value), message = as.character(message),
      stringsAsFactors = FALSE
    )
  )
}

normalize_text <- function(x) {
  out <- tolower(trimws(gsub("\\s+", " ", as.character(x))))
  out[is.na(x) | out == ""] <- NA_character_
  out
}

parse_number <- function(x, column, rows, integer_only = FALSE) {
  text <- trimws(as.character(x))
  missing <- is.na(x) | text == ""
  value <- suppressWarnings(as.numeric(text))
  invalid <- !missing & (!is.finite(value) |
    (integer_only & abs(value - round(value)) > 1e-9))
  for (i in which(invalid)) {
    add_issue(
      "error", paste0(column, "_parse"),
      sprintf("%s must be a valid%s number.", column,
        ifelse(integer_only, " integer", "")),
      rows[[i]], column = column, value = text[[i]]
    )
  }
  value[missing | invalid] <- NA_real_
  if (integer_only) as.integer(round(value)) else value
}

parse_flag <- function(x, column, rows) {
  text <- normalize_text(x)
  value <- rep(NA, length(text))
  value[text %in% c("true", "1", "yes")] <- TRUE
  value[text %in% c("false", "0", "no")] <- FALSE
  invalid <- !is.na(text) & !(text %in% c("true", "1", "yes", "false", "0", "no"))
  for (i in which(invalid)) {
    add_issue(
      "error", paste0(column, "_parse"),
      sprintf("%s must be true/false, 1/0, or yes/no.", column),
      rows[[i]], column = column, value = text[[i]]
    )
  }
  for (i in which(is.na(text))) {
    add_issue(
      "warning", paste0(column, "_missing"),
      sprintf("%s is missing; it remains unknown and is not treated as TRUE.", column),
      rows[[i]], column = column
    )
  }
  value
}

write_summary <- function(payload) {
  jsonlite::write_json(
    payload, file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE, na = "null"
  )
}

validation_checks <- data.frame(
  check = character(), passed = logical(), severity = character(),
  details = character(), stringsAsFactors = FALSE
)
add_check <- function(check, passed, details, severity = "error") {
  validation_checks <<- bind_rows(
    validation_checks,
    data.frame(
      check = check, passed = isTRUE(passed), severity = severity,
      details = details, stringsAsFactors = FALSE
    )
  )
}

write_validation <- function(data = NULL, mapping = NULL) {
  data.table::fwrite(
    validation_checks, file.path(output_dir, "validation_report.csv")
  )
  data.table::fwrite(issues, file.path(output_dir, "invalid_rows.csv"))
  if (is.null(mapping)) {
    mapping <- data.frame(
      question_target = character(), question_type = character(),
      n = integer(), stringsAsFactors = FALSE
    )
  }
  data.table::fwrite(
    mapping, file.path(output_dir, "question_type_mapping.csv")
  )
  if (!is.null(data)) {
    export <- data %>%
      mutate(across(where(is.factor), as.character))
    data.table::fwrite(
      export, file.path(output_dir, "cleaned_question_level_data.csv")
    )
  }
}

raw <- tryCatch(
  data.table::fread(
    input_path, sep = "auto", colClasses = "character",
    na.strings = c("NA", "NaN", "NULL"), data.table = FALSE,
    check.names = FALSE, strip.white = FALSE
  ),
  error = function(e) e
)
if (inherits(raw, "error")) {
  add_issue("error", "input_read", conditionMessage(raw))
  add_check("input_read", FALSE, conditionMessage(raw))
  write_validation()
  write_summary(list(status = "validation_failed", reason = conditionMessage(raw)))
  stop("Could not read input; see analysis_summary.json.", call. = FALSE)
}

normalized_names <- normalize_text(names(raw))
duplicate_names <- unique(normalized_names[duplicated(normalized_names)])
missing_columns <- setdiff(required_columns, normalized_names)
add_check(
  "unique_normalized_columns", length(duplicate_names) == 0L,
  ifelse(length(duplicate_names), paste(duplicate_names, collapse = ", "),
    "Column names are unique after normalization.")
)
add_check(
  "required_columns", length(missing_columns) == 0L,
  ifelse(length(missing_columns), paste("Missing:", paste(missing_columns, collapse = ", ")),
    "All required columns are present.")
)
if (length(duplicate_names) > 0L || length(missing_columns) > 0L) {
  if (length(duplicate_names)) {
    add_issue(
      "error", "duplicate_columns",
      paste("Duplicate normalized columns:", paste(duplicate_names, collapse = ", "))
    )
  }
  if (length(missing_columns)) {
    add_issue(
      "error", "required_columns",
      paste("Missing required columns:", paste(missing_columns, collapse = ", "))
    )
  }
  write_validation()
  write_summary(list(
    status = "validation_failed", missing_columns = missing_columns,
    duplicate_columns = duplicate_names
  ))
  stop("Input columns failed validation; see validation outputs.", call. = FALSE)
}
names(raw) <- normalized_names

data <- raw %>%
  mutate(
    input_row = row_number() + 1L,
    participant_id = trimws(as.character(participant_id)),
    paper_order_raw = paper_order,
    paper_order = normalize_text(paper_order),
    field_type_raw = field_type,
    field_type = normalize_text(field_type),
    field_type = recode(field_type, "out of field" = "out_field",
      "out-of-field" = "out_field", "in field" = "in_field",
      "in-field" = "in_field"),
    question_target_raw = question_target,
    question_target_key = normalize_text(question_target),
    question_target = case_when(
      question_target_key == "planted error" ~ "Planted error",
      question_target_key == "unstated rationale" ~ "Unstated rationale",
      question_target_key %in% c(
        "background knowledge", "background knowlegde", "background knowledgde"
      ) ~ "Background knowledge",
      question_target_key == "failure mode" ~ "Failure mode",
      TRUE ~ NA_character_
    ),
    question_type_raw = question_type,
    question_type = normalize_text(question_type)
  )

data$paper_position <- parse_number(
  data$paper_position, "paper_position", data$input_row, TRUE
)
data$position <- parse_number(data$position, "position", data$input_row, TRUE)
data$duration_ms <- parse_number(data$duration_ms, "duration_ms", data$input_row)
data$score <- parse_number(data$score, "score", data$input_row)
data$attempt_score <- parse_number(
  data$attempt_score, "attempt_score", data$input_row
)
data$skipped <- parse_flag(data$skipped, "skipped", data$input_row)
data$timed_out <- parse_flag(data$timed_out, "timed_out", data$input_row)

for (i in which(is.na(data$participant_id) | data$participant_id == "")) {
  add_issue(
    "error", "participant_id", "participant_id is required.",
    data$input_row[[i]], column = "participant_id"
  )
}
for (i in which(is.na(data$paper_order) |
  !(data$paper_order %in% c("own", "foreign")))) {
  add_issue(
    "error", "paper_order", "paper_order must be own or foreign.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]],
    "paper_order", data$paper_order_raw[[i]]
  )
}
for (i in which(is.na(data$paper_position) |
  !(data$paper_position %in% c(1L, 2L)))) {
  add_issue(
    "error", "paper_position", "paper_position must be 1 or 2.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]],
    "paper_position", raw$paper_position[[i]]
  )
}
for (i in which(is.na(data$position) | !(data$position %in% 1:8))) {
  add_issue(
    "error", "position", "position must be an integer from 1 through 8.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]],
    "position", raw$position[[i]]
  )
}
for (i in which(is.na(data$question_target))) {
  add_issue(
    "error", "question_target",
    paste0("Unrecognized question_target; expected one of: ",
      paste(target_levels, collapse = ", "), "."),
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]],
    "question_target", data$question_target_raw[[i]]
  )
}
for (i in which(is.na(data$question_type))) {
  add_issue(
    "error", "question_type", "question_type is required.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]],
    "question_type", data$question_type_raw[[i]]
  )
}
for (i in which(!is.na(data$score) & (data$score < 0 | data$score > 100))) {
  add_issue(
    "error", "score_range", "Parsed score must be between 0 and 100.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]],
    "score", raw$score[[i]]
  )
}
for (i in which(is.na(data$score) &
  !(data$skipped %in% TRUE | data$timed_out %in% TRUE))) {
  add_issue(
    "warning", "score_missing",
    "Genuinely missing score is retained as NA because neither known flag is TRUE.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]],
    "score", raw$score[[i]]
  )
}
for (i in which(data$skipped %in% TRUE & data$timed_out %in% TRUE)) {
  add_issue(
    "warning", "both_nonresponse_flags",
    "Both skipped and timed_out are TRUE; accepted and scored as zero.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]]
  )
}

data <- data %>%
  mutate(
    definite_nonresponse = skipped %in% TRUE | timed_out %in% TRUE,
    definite_response = skipped %in% FALSE & timed_out %in% FALSE,
    nonresponse_status_known = definite_nonresponse | definite_response,
    score_analysis = case_when(
      definite_nonresponse ~ 0,
      TRUE ~ score
    ),
    score01 = score_analysis / 100
  )
for (i in which(!is.na(data$score_analysis) &
  (data$score_analysis < 0 | data$score_analysis > 100))) {
  add_issue(
    "error", "primary_score_range",
    "score_analysis must be between 0 and 100.",
    data$input_row[[i]], data$participant_id[[i]], data$paper_position[[i]]
  )
}

participant_groups <- split(data, data$participant_id, drop = TRUE)
for (pid in names(participant_groups)) {
  z <- participant_groups[[pid]]
  if (nrow(z) != 16L) {
    add_issue(
      "error", "rows_per_participant",
      sprintf("Expected exactly 16 rows; found %d.", nrow(z)),
      participant_id = pid
    )
  }
  positions <- sort(unique(z$paper_position[!is.na(z$paper_position)]))
  if (!identical(positions, c(1L, 2L))) {
    add_issue(
      "error", "participant_paper_positions",
      paste("Expected paper positions 1 and 2; found", paste(positions, collapse = ", ")),
      participant_id = pid
    )
  }
  first_orders <- unique(
    z$paper_order[z$paper_position == 1L & !is.na(z$paper_order)]
  )
  if (length(first_orders) != 1L) {
    add_issue(
      "error", "first_paper_order",
      paste0(
        "Position-1 rows must contain exactly one paper_order value; found ",
        length(first_orders), "."
      ),
      participant_id = pid
    )
  }
}

test_groups <- split(
  data,
  interaction(data$participant_id, data$paper_position,
    drop = TRUE, lex.order = TRUE),
  drop = TRUE
)
for (z in test_groups) {
  pid <- z$participant_id[[1]]
  pos <- z$paper_position[[1]]
  if (nrow(z) != 8L) {
    add_issue(
      "error", "rows_per_test", sprintf("Expected exactly 8 rows; found %d.", nrow(z)),
      participant_id = pid, paper_position = pos
    )
  }
  observed_positions <- sort(z$position)
  if (length(observed_positions) != 8L || anyNA(observed_positions) ||
    !identical(observed_positions, 1:8)) {
    add_issue(
      "error", "positions_per_test",
      paste("Expected unique positions 1:8; found",
        paste(observed_positions, collapse = ", ")),
      participant_id = pid, paper_position = pos
    )
  }
  target_counts <- table(factor(z$question_target, levels = target_levels))
  if (any(target_counts != 2L)) {
    add_issue(
      "error", "targets_per_test",
      paste(names(target_counts), as.integer(target_counts),
        sep = "=", collapse = "; "),
      participant_id = pid, paper_position = pos
    )
  }
  nonmissing_attempts <- unique(z$attempt_score[!is.na(z$attempt_score)])
  if (length(nonmissing_attempts) > 1L) {
    add_issue(
      "error", "attempt_score_consistency",
      paste("attempt_score has multiple nonmissing values:",
        paste(nonmissing_attempts, collapse = ", ")),
      participant_id = pid, paper_position = pos, column = "attempt_score"
    )
  }
}

mapping <- data %>%
  filter(!is.na(question_target), !is.na(question_type)) %>%
  count(question_target, question_type, name = "n") %>%
  arrange(match(question_target, target_levels), question_type)
target_type_counts <- mapping %>%
  count(question_target, name = "type_count")
target_unique <- nrow(target_type_counts) == 4L &&
  all(target_type_counts$type_count == 1L)
mapped_type <- setNames(mapping$question_type, mapping$question_target)
mapping_relationship <- target_unique &&
  length(unique(unname(mapped_type[target_levels[2:4]]))) == 1L &&
  unname(mapped_type[["Planted error"]]) !=
    unname(mapped_type[["Unstated rationale"]])
if (!mapping_relationship) {
  add_issue(
    "error", "question_type_mapping",
    paste0(
      "Each target must map to one type; the three free-response targets must ",
      "share a type; and Planted error must use a different type."
    )
  )
}

first_order <- data %>%
  filter(paper_position == 1L) %>%
  group_by(participant_id) %>%
  summarise(
    first_paper = if (n_distinct(paper_order, na.rm = TRUE) == 1L)
      first(na.omit(paper_order)) else NA_character_,
    .groups = "drop"
  )
data <- data %>%
  left_join(first_order, by = "participant_id") %>%
  mutate(
    paper_type = case_when(
      paper_position == 1L ~ first_paper,
      paper_position == 2L & first_paper == "own" ~ "foreign",
      paper_position == 2L & first_paper == "foreign" ~ "own",
      TRUE ~ NA_character_
    )
  )

paper_pair_check <- data %>%
  distinct(participant_id, paper_position, paper_type) %>%
  group_by(participant_id) %>%
  summarise(
    n_tests = n(), own = sum(paper_type == "own", na.rm = TRUE),
    foreign = sum(paper_type == "foreign", na.rm = TRUE), .groups = "drop"
  )
for (i in which(paper_pair_check$n_tests != 2L |
  paper_pair_check$own != 1L | paper_pair_check$foreign != 1L)) {
  add_issue(
    "error", "own_foreign_pair",
    "Derived tests must contain exactly one own and one foreign paper.",
    participant_id = paper_pair_check$participant_id[[i]]
  )
}

foreign_fields <- data %>%
  filter(paper_type == "foreign") %>%
  group_by(participant_id) %>%
  summarise(
    values = paste(sort(unique(field_type[!is.na(field_type)])), collapse = "|"),
    n_values = n_distinct(field_type, na.rm = TRUE),
    all_valid = all(is.na(field_type) |
      field_type %in% c("out_field", "in_field")),
    any_missing = any(is.na(field_type)), .groups = "drop"
  )
for (i in seq_len(nrow(foreign_fields))) {
  if (!foreign_fields$all_valid[[i]] || foreign_fields$n_values[[i]] != 1L ||
    foreign_fields$any_missing[[i]]) {
    add_issue(
      "error", "foreign_field",
      paste0(
        "Foreign-paper field_type must be nonmissing, valid, and exactly one ",
        "of out_field/in_field per participant; observed '",
        foreign_fields$values[[i]], "'."
      ),
      participant_id = foreign_fields$participant_id[[i]]
    )
  }
}
participant_field <- foreign_fields %>%
  transmute(
    participant_id,
    participant_field = ifelse(
      n_values == 1L & all_valid & !any_missing, values, NA_character_
    )
  )
data <- data %>%
  left_join(participant_field, by = "participant_id") %>%
  mutate(
    paper_type = factor(paper_type, levels = c("foreign", "own")),
    paper_order = factor(first_paper, levels = c("own", "foreign")),
    field_type = ifelse(paper_type == "foreign", participant_field, NA_character_),
    field_type = factor(field_type, levels = c("out_field", "in_field")),
    question_target = factor(question_target, levels = target_levels)
  )

error_checks <- unique(issues$check[issues$severity == "error"])
warning_checks <- unique(issues$check[issues$severity == "warning"])
known_checks <- c(
  "required_columns", "unique_normalized_columns", "participant_id",
  "paper_order", "paper_position", "position", "question_target",
  "question_type", "score_parse", "score_range", "primary_score_range",
  "skipped_parse", "timed_out_parse", "rows_per_participant",
  "participant_paper_positions", "first_paper_order", "rows_per_test",
  "positions_per_test", "targets_per_test", "attempt_score_consistency",
  "question_type_mapping", "own_foreign_pair", "foreign_field"
)
existing_checks <- validation_checks$check
for (check in setdiff(known_checks, existing_checks)) {
  add_check(
    check, !(check %in% error_checks),
    if (check %in% error_checks) "One or more actionable errors were found."
    else "Check passed."
  )
}
for (check in warning_checks) {
  add_check(
    check, TRUE,
    sprintf("%d warning(s); values were retained as documented.",
      sum(issues$check == check)),
    severity = "warning"
  )
}
for (check in setdiff(unique(issues$check), validation_checks$check)) {
  is_error <- any(issues$check == check & issues$severity == "error")
  add_check(
    check, !is_error,
    sprintf(
      "%d issue(s) recorded in invalid_rows.csv.",
      sum(issues$check == check)
    ),
    severity = ifelse(is_error, "error", "warning")
  )
}

write_validation(data, mapping)
hard_error_count <- sum(issues$severity == "error")
if (hard_error_count > 0L) {
  write_summary(list(
    status = "validation_failed", hard_error_count = hard_error_count,
    warning_count = sum(issues$severity == "warning"),
    rows = nrow(data), participants = n_distinct(data$participant_id),
    validation_checks = validation_checks
  ))
  stop(
    "Hard validation failed; outputs were written and no models were fit.",
    call. = FALSE
  )
}

# Descriptive outputs -------------------------------------------------------
summarise_scores <- function(df, groups = character()) {
  df %>%
    group_by(across(all_of(groups))) %>%
    summarise(
      n = n(), total = sum(!is.na(score_analysis)),
      missing = sum(is.na(score_analysis)),
      mean = ifelse(total > 0L, mean(score_analysis, na.rm = TRUE), NA_real_),
      sd = ifelse(total > 1L, sd(score_analysis, na.rm = TRUE), NA_real_),
      median = ifelse(total > 0L, median(score_analysis, na.rm = TRUE), NA_real_),
      zero_rate = ifelse(total > 0L,
        mean(score_analysis == 0, na.rm = TRUE), NA_real_),
      one_rate = ifelse(total > 0L,
        mean(score_analysis == 100, na.rm = TRUE), NA_real_),
      nonresponse_rate = ifelse(
        sum(nonresponse_status_known) > 0L,
        mean(definite_nonresponse[nonresponse_status_known]),
        NA_real_
      ),
      .groups = "drop"
    )
}

descriptive_overall <- summarise_scores(data) %>% mutate(scope = "overall")
descriptive_category <- summarise_scores(data, "question_target")
descriptive_paper <- summarise_scores(data, "paper_type")
descriptive_paper_category <- summarise_scores(
  data, c("paper_type", "question_target")
)
participant_test <- data %>%
  group_by(participant_id, paper_position, paper_type, paper_order) %>%
  summarise(
    questions = n(), observed_scores = sum(!is.na(score_analysis)),
    missing_scores = sum(is.na(score_analysis)),
    mean_score = mean(score_analysis, na.rm = FALSE),
    total_score = ifelse(anyNA(score_analysis), NA_real_, sum(score_analysis)),
    zero_count = sum(score_analysis == 0, na.rm = TRUE),
    known_response_status_count = sum(nonresponse_status_known),
    nonresponse_count = sum(definite_nonresponse),
    .groups = "drop"
  )
data.table::fwrite(descriptive_overall,
  file.path(output_dir, "descriptive_overall.csv"))
data.table::fwrite(descriptive_category,
  file.path(output_dir, "descriptive_by_question_target.csv"))
data.table::fwrite(descriptive_paper,
  file.path(output_dir, "descriptive_by_paper_type.csv"))
data.table::fwrite(
  descriptive_paper_category,
  file.path(output_dir, "descriptive_by_paper_type_and_question_target.csv")
)
data.table::fwrite(
  participant_test %>% mutate(across(where(is.factor), as.character)),
  file.path(output_dir, "participant_test_summaries.csv")
)

plot_score_paper <- ggplot(data, aes(paper_type, score_analysis, fill = paper_type)) +
  geom_boxplot(outlier.alpha = 0.25) +
  labs(x = "Paper type", y = "Question score", title = "Scores by paper type") +
  theme_minimal() + theme(legend.position = "none")
ggsave(file.path(output_dir, "score_by_paper_type.png"),
  plot_score_paper, width = 7, height = 5, dpi = 300)

plot_score_category <- ggplot(
  data, aes(question_target, score_analysis, fill = paper_type)
) +
  geom_boxplot(outlier.alpha = 0.25, position = position_dodge(width = 0.8)) +
  labs(x = "Question target", y = "Question score",
    fill = "Paper type", title = "Own and foreign scores by question target") +
  theme_minimal() +
  theme(axis.text.x = element_text(angle = 25, hjust = 1))
ggsave(file.path(output_dir, "score_by_question_target.png"),
  plot_score_category, width = 8, height = 5, dpi = 300)

# Reusable model and emmeans helpers ---------------------------------------
empty_attempt <- function() {
  data.frame(
    analysis = character(), attempt = integer(), structure = character(),
    formula = character(), status = character(), stable = logical(),
    nobs = integer(), optimizer_code = integer(), optimizer_message = character(),
    pdHess = logical(), finite_fixed_effects = logical(),
    random_intercept_sd = numeric(), random_slope_sd = numeric(),
    random_correlation = numeric(), random_extraction_error = character(),
    warnings = character(), error = character(), rejection_reason = character(),
    stringsAsFactors = FALSE
  )
}
all_attempts <- empty_attempt()
all_diagnostics <- data.frame()

extract_random <- function(model) {
  result <- list(
    intercept_sd = NA_real_, slope_sd = NA_real_,
    correlation = NA_real_, random_sd = NA_character_,
    extraction_error = ""
  )
  conditional <- tryCatch(
    glmmTMB::VarCorr(model)$cond,
    error = function(e) {
      result$extraction_error <<- conditionMessage(e)
      NULL
    }
  )
  if (is.null(conditional) || length(conditional) == 0L) {
    if (result$extraction_error == "") {
      result$extraction_error <- "No conditional random-effects component."
    }
    return(result)
  }
  block_summaries <- character()
  for (block_index in seq_along(conditional)) {
    covariance <- conditional[[block_index]]
    standard_deviations <- attr(covariance, "stddev")
    if (is.null(standard_deviations)) {
      standard_deviations <- sqrt(diag(covariance))
    }
    term_names <- names(standard_deviations)
    if (is.null(term_names)) term_names <- rownames(covariance)
    names(standard_deviations) <- term_names
    intercept_index <- which(term_names == "(Intercept)")
    slope_index <- grep("^paper_type", term_names)
    if (
      is.na(result$intercept_sd) && length(intercept_index) > 0L
    ) {
      result$intercept_sd <- as.numeric(
        standard_deviations[[intercept_index[[1]]]]
      )
    }
    if (is.na(result$slope_sd) && length(slope_index) > 0L) {
      result$slope_sd <- as.numeric(
        standard_deviations[[slope_index[[1]]]]
      )
    }
    correlation <- attr(covariance, "correlation")
    if (
      is.na(result$correlation) && !is.null(correlation) &&
        length(intercept_index) > 0L && length(slope_index) > 0L
    ) {
      result$correlation <- as.numeric(
        correlation[intercept_index[[1]], slope_index[[1]]]
      )
    }
    block_name <- names(conditional)[[block_index]]
    if (is.null(block_name) || is.na(block_name) || block_name == "") {
      block_name <- paste0("block_", block_index)
    }
    block_summaries <- c(
      block_summaries,
      paste0(
        block_name, ":",
        paste(
          paste0(term_names, "=", sprintf("%.6g", standard_deviations)),
          collapse = ","
        )
      )
    )
  }
  result$random_sd <- paste(block_summaries, collapse = " | ")
  result
}

fit_once <- function(formula_text, fit_data, family, analysis, structure,
    attempt) {
  captured_warnings <- character()
  fit_error <- NULL
  model <- tryCatch(
    withCallingHandlers(
      glmmTMB::glmmTMB(
        formula = stats::as.formula(formula_text), data = fit_data,
        family = family, na.action = stats::na.exclude
      ),
      warning = function(w) {
        captured_warnings <<- c(captured_warnings, conditionMessage(w))
        invokeRestart("muffleWarning")
      }
    ),
    error = function(e) {
      fit_error <<- conditionMessage(e)
      NULL
    }
  )
  optimizer_code <- if (
    is.null(model) || is.null(model$fit$convergence) ||
      length(model$fit$convergence) == 0L
  ) {
    NA_integer_
  } else {
    suppressWarnings(as.integer(model$fit$convergence[[1]]))
  }
  optimizer_message <- if (is.null(model)) "" else
    paste(model$fit$message, collapse = " | ")
  pd_hess <- if (is.null(model)) FALSE else isTRUE(model$sdr$pdHess)
  finite_beta <- if (is.null(model)) FALSE else tryCatch(
    all(is.finite(glmmTMB::fixef(model)$cond)), error = function(e) FALSE
  )
  random <- if (is.null(model)) list(
    intercept_sd = NA_real_, slope_sd = NA_real_, correlation = NA_real_,
    random_sd = NA_character_, extraction_error = "Model fit failed."
  ) else extract_random(model)
  warning_bad <- any(grepl(
    "converg|singular|non-positive-definite|not positive definite|false convergence",
    captured_warnings, ignore.case = TRUE
  ))
  reasons <- character()
  if (is.null(model)) reasons <- c(reasons, "fit error")
  if (is.na(optimizer_code) || optimizer_code != 0L)
    reasons <- c(reasons, "optimizer convergence code is not zero")
  if (!pd_hess) reasons <- c(reasons, "sdr$pdHess is not TRUE")
  if (!finite_beta) reasons <- c(reasons, "nonfinite fixed effects")
  if (warning_bad) reasons <- c(reasons, "unstable fit warning")
  if (
    is.na(random$intercept_sd) || !is.finite(random$intercept_sd) ||
      random$intercept_sd <= 1e-4
  ) {
    reasons <- c(
      reasons,
      "random intercept SD <= 1e-4, nonfinite, or unavailable"
    )
  }
  if (grepl("slope", structure) &&
    (
      is.na(random$slope_sd) || !is.finite(random$slope_sd) ||
        random$slope_sd <= 1e-4
    )) {
    reasons <- c(
      reasons,
      "random slope SD <= 1e-4, nonfinite, or unavailable"
    )
  }
  if (structure == "correlated_slope" &&
    (
      is.na(random$correlation) || !is.finite(random$correlation) ||
        abs(random$correlation) >= 0.99
    )) {
    reasons <- c(
      reasons,
      "|random slope correlation| >= 0.99, nonfinite, or unavailable"
    )
  }
  stable <- length(reasons) == 0L
  row <- data.frame(
    analysis = analysis, attempt = attempt, structure = structure,
    formula = formula_text,
    status = ifelse(is.null(model), "fit_failed",
      ifelse(stable, "stable", "unstable")),
    stable = stable,
    nobs = if (is.null(model)) 0L else as.integer(stats::nobs(model)),
    optimizer_code = optimizer_code,
    optimizer_message = optimizer_message, pdHess = pd_hess,
    finite_fixed_effects = finite_beta,
    random_intercept_sd = random$intercept_sd,
    random_slope_sd = random$slope_sd,
    random_correlation = random$correlation,
    random_extraction_error = random$extraction_error,
    warnings = paste(unique(captured_warnings), collapse = " | "),
    error = ifelse(is.null(fit_error), "", fit_error),
    rejection_reason = paste(reasons, collapse = " | "),
    stringsAsFactors = FALSE
  )
  list(model = model, stable = stable, attempt = row, random = random,
    warnings = captured_warnings)
}

fit_h1_fallback <- function(fit_data, response, family, analysis) {
  fixed <- paste0(response,
    " ~ paper_type * question_target + ")
  specs <- data.frame(
    structure = c("correlated_slope", "uncorrelated_slope", "intercept_only"),
    random = c(
      "(1 + paper_type | participant_id)",
      "(1 + paper_type || participant_id)",
      "(1 | participant_id)"
    ),
    stringsAsFactors = FALSE
  )
  selected <- NULL
  attempts <- list()
  for (i in seq_len(nrow(specs))) {
    one <- fit_once(
      paste0(fixed, specs$random[[i]]), fit_data, family, analysis,
      specs$structure[[i]], i
    )
    attempts[[i]] <- one$attempt
    if (one$stable) {
      selected <- c(one, list(
        structure = specs$structure[[i]],
        formula = paste0(fixed, specs$random[[i]])
      ))
      break
    }
  }
  list(selected = selected, attempts = bind_rows(attempts))
}

fit_ri <- function(formula_text, fit_data, family, analysis) {
  one <- fit_once(
    formula_text, fit_data, family, analysis, "random_intercept", 1L
  )
  list(
    selected = if (one$stable)
      c(one, list(structure = "random_intercept", formula = formula_text))
    else NULL,
    attempts = one$attempt
  )
}

model_diagnostic <- function(selected, analysis) {
  if (is.null(selected)) {
    return(data.frame(
      analysis = analysis, status = "no_stable_fit",
      selected_structure = NA_character_, formula = NA_character_,
      nobs = 0L, optimizer_code = NA_integer_, optimizer_message = NA_character_,
      pdHess = FALSE, warnings = NA_character_, random_sd = NA_character_,
      random_intercept_sd = NA_real_, random_slope_sd = NA_real_,
      random_correlation = NA_real_, random_extraction_error = NA_character_,
      AIC = NA_real_, logLik = NA_real_,
      stringsAsFactors = FALSE
    ))
  }
  m <- selected$model
  data.frame(
    analysis = analysis, status = "stable",
    selected_structure = selected$structure, formula = selected$formula,
    nobs = as.integer(stats::nobs(m)),
    optimizer_code = as.integer(m$fit$convergence),
    optimizer_message = paste(m$fit$message, collapse = " | "),
    pdHess = isTRUE(m$sdr$pdHess),
    warnings = paste(unique(selected$warnings), collapse = " | "),
    random_sd = selected$random$random_sd,
    random_intercept_sd = selected$random$intercept_sd,
    random_slope_sd = selected$random$slope_sd,
    random_correlation = selected$random$correlation,
    random_extraction_error = selected$random$extraction_error,
    AIC = stats::AIC(m), logLik = as.numeric(stats::logLik(m)),
    stringsAsFactors = FALSE
  )
}

write_model_text <- function(selected, stem) {
  if (is.null(selected)) {
    writeLines("NO STABLE MODEL AVAILABLE",
      file.path(output_dir, paste0(stem, "_summary.txt")))
    writeLines("NO STABLE MODEL AVAILABLE",
      file.path(output_dir, paste0(stem, "_varcorr.txt")))
  } else {
    writeLines(capture.output(summary(selected$model)),
      file.path(output_dir, paste0(stem, "_summary.txt")))
    writeLines(capture.output(print(glmmTMB::VarCorr(selected$model))),
      file.path(output_dir, paste0(stem, "_varcorr.txt")))
  }
}

empty_emm <- function(by_name = "question_target") {
  out <- data.frame(
    level = character(), estimate = numeric(), SE = numeric(),
    df = numeric(), lower.CL = numeric(), upper.CL = numeric(),
    stringsAsFactors = FALSE
  )
  names(out)[[1]] <- by_name
  out
}

standardize_response_emm <- function(x) {
  x <- as.data.frame(x)
  estimate_name <- intersect(c("response", "prob", "emmean"), names(x))
  lower_name <- intersect(c("lower.CL", "asymp.LCL", "lower.HPD"), names(x))
  upper_name <- intersect(c("upper.CL", "asymp.UCL", "upper.HPD"), names(x))
  if (!length(estimate_name)) stop("No response estimate column returned by emmeans.")
  x$response_score <- 100 * x[[estimate_name[[1]]]]
  x$lower_score <- if (length(lower_name)) 100 * x[[lower_name[[1]]]] else NA_real_
  x$upper_score <- if (length(upper_name)) 100 * x[[upper_name[[1]]]] else NA_real_
  x
}

extract_h1_emmeans <- function(selected, prefix) {
  contrast_file <- file.path(output_dir, paste0(prefix, "_contrasts.csv"))
  response_file <- file.path(output_dir, paste0(prefix, "_response_means.csv"))
  if (is.null(selected)) {
    data.table::fwrite(data.frame(
      question_target = character(), contrast = character(),
      estimate = numeric(), SE = numeric(), df = numeric(),
      z.ratio = numeric(), p.value = numeric(), p.value.holm = numeric(),
      stringsAsFactors = FALSE
    ), contrast_file)
    data.table::fwrite(empty_emm(), response_file)
    return(list(contrasts = data.frame(), response = data.frame(),
      error = "No stable model."))
  }
  error <- NULL
  result <- tryCatch({
    link <- emmeans::emmeans(
      selected$model, ~ paper_type | question_target, type = "link"
    )
    contrasts <- as.data.frame(emmeans::contrast(
      link, method = list("own - foreign" = c(-1, 1)), adjust = "none"
    ))
    if (nrow(contrasts) != 4L) {
      stop(sprintf("Expected exactly four H1 contrasts; got %d.", nrow(contrasts)))
    }
    contrasts$p.value.holm <- p.adjust(contrasts$p.value, method = "holm")
    response <- standardize_response_emm(emmeans::emmeans(
      selected$model, ~ paper_type | question_target, type = "response"
    ))
    data.table::fwrite(contrasts, contrast_file)
    data.table::fwrite(response, response_file)
    list(contrasts = contrasts, response = response, error = NULL)
  }, error = function(e) {
    error <<- conditionMessage(e)
    data.table::fwrite(data.frame(error = error), contrast_file)
    data.table::fwrite(data.frame(error = error), response_file)
    list(contrasts = data.frame(), response = data.frame(), error = error)
  })
  result
}

extract_h2_emmeans <- function(selected, prefix) {
  contrast_file <- file.path(output_dir, paste0(prefix, "_contrast.csv"))
  response_file <- file.path(output_dir, paste0(prefix, "_response_means.csv"))
  if (is.null(selected)) {
    data.table::fwrite(data.frame(
      contrast = character(), estimate = numeric(), SE = numeric(),
      df = numeric(), z.ratio = numeric(), p.value = numeric(),
      stringsAsFactors = FALSE
    ), contrast_file)
    data.table::fwrite(empty_emm("field_type"), response_file)
    return(list(contrast = data.frame(), response = data.frame(),
      error = "No stable model."))
  }
  tryCatch({
    link <- emmeans::emmeans(selected$model, ~ field_type, type = "link")
    contrast <- as.data.frame(emmeans::contrast(
      link, method = list("in_field - out_field" = c(-1, 1)),
      adjust = "none"
    ))
    response <- standardize_response_emm(emmeans::emmeans(
      selected$model, ~ field_type, type = "response"
    ))
    data.table::fwrite(contrast, contrast_file)
    data.table::fwrite(response, response_file)
    list(contrast = contrast, response = response, error = NULL)
  }, error = function(e) {
    msg <- conditionMessage(e)
    data.table::fwrite(data.frame(error = msg), contrast_file)
    data.table::fwrite(data.frame(error = msg), response_file)
    list(contrast = data.frame(), response = data.frame(), error = msg)
  })
}

register_fit <- function(result, analysis, stem) {
  all_attempts <<- bind_rows(all_attempts, result$attempts)
  all_diagnostics <<- bind_rows(
    all_diagnostics, model_diagnostic(result$selected, analysis)
  )
  write_model_text(result$selected, stem)
}

# Primary H1 and H2 ---------------------------------------------------------
ordbeta_family <- glmmTMB::ordbeta(link = "logit")
h1 <- fit_h1_fallback(data, "score01", ordbeta_family, "primary_h1")
register_fit(h1, "primary_h1", "h1_primary")
h1_emm <- extract_h1_emmeans(h1$selected, "h1_primary")

foreign_data <- data %>% filter(paper_type == "foreign")
h2 <- fit_ri(
  paste0(
    "score01 ~ field_type + question_target + ",
    "(1 | participant_id)"
  ),
  foreign_data, ordbeta_family, "primary_h2"
)
register_fit(h2, "primary_h2", "h2_primary")
h2_emm <- extract_h2_emmeans(h2$selected, "h2_primary")

foreign_participant <- foreign_data %>%
  group_by(participant_id, field_type) %>%
  summarise(
    foreign_score = mean(score_analysis, na.rm = FALSE),
    question_count = n(), missing_scores = sum(is.na(score_analysis)),
    .groups = "drop"
  )
data.table::fwrite(
  foreign_participant %>% mutate(field_type = as.character(field_type)),
  file.path(output_dir, "foreign_participant_scores.csv")
)
plot_foreign_field <- ggplot(
  foreign_participant, aes(field_type, foreign_score, fill = field_type)
) +
  geom_boxplot(outlier.alpha = 0.3) +
  geom_jitter(width = 0.08, alpha = 0.5) +
  labs(x = "Foreign-paper field", y = "Participant mean score",
    title = "Foreign-paper participant means by field") +
  theme_minimal() + theme(legend.position = "none")
ggsave(file.path(output_dir, "foreign_participant_means_by_field.png"),
  plot_foreign_field, width = 7, height = 5, dpi = 300)

# Participant-level robustness tests --------------------------------------
tidy_test <- function(name, expression) {
  captured <- character()
  error <- NULL
  object <- tryCatch(
    withCallingHandlers(
      expression,
      warning = function(w) {
        captured <<- c(captured, conditionMessage(w))
        invokeRestart("muffleWarning")
      }
    ),
    error = function(e) {
      error <<- conditionMessage(e)
      NULL
    }
  )
  if (is.null(object)) {
    row <- data.frame(
      test = name, status = "error", estimate_1 = NA_real_,
      estimate_2 = NA_real_, statistic = NA_real_, parameter = NA_real_,
      p.value = NA_real_, conf.low = NA_real_, conf.high = NA_real_,
      method = NA_character_, warnings = paste(captured, collapse = " | "),
      error = error, stringsAsFactors = FALSE
    )
    text <- c(paste(name, "ERROR"), error, captured)
  } else {
    estimates <- unname(object$estimate)
    interval <- object$conf.int
    parameter <- if (length(object$parameter) > 0L) {
      unname(object$parameter[[1]])
    } else {
      NA_real_
    }
    conf_low <- if (length(interval) >= 1L) interval[[1]] else NA_real_
    conf_high <- if (length(interval) >= 2L) interval[[2]] else NA_real_
    row <- data.frame(
      test = name, status = "completed",
      estimate_1 = ifelse(length(estimates) >= 1L, estimates[[1]], NA_real_),
      estimate_2 = ifelse(length(estimates) >= 2L, estimates[[2]], NA_real_),
      statistic = unname(object$statistic),
      parameter = parameter,
      p.value = object$p.value,
      conf.low = conf_low,
      conf.high = conf_high,
      method = object$method, warnings = paste(captured, collapse = " | "),
      error = "", stringsAsFactors = FALSE
    )
    text <- c(capture.output(print(object)), "", "Captured warnings:", captured)
  }
  list(row = row, text = text)
}

robust_complete <- foreign_participant %>%
  filter(!is.na(foreign_score), !is.na(field_type))
field_counts <- table(robust_complete$field_type)
enough_groups <- length(field_counts) == 2L && all(field_counts >= 2L)
if (enough_groups) {
  welch <- tidy_test(
    "Welch two-sample t-test",
    stats::t.test(foreign_score ~ field_type, data = robust_complete,
      var.equal = FALSE, conf.level = 0.95)
  )
  wilcox <- tidy_test(
    "Wilcoxon rank-sum test",
    stats::wilcox.test(foreign_score ~ field_type, data = robust_complete,
      exact = FALSE, conf.int = TRUE)
  )
} else {
  msg <- "Insufficient complete participant observations in both field groups."
  welch <- list(
    row = data.frame(
      test = "Welch two-sample t-test", status = "error",
      estimate_1 = NA_real_, estimate_2 = NA_real_, statistic = NA_real_,
      parameter = NA_real_, p.value = NA_real_, conf.low = NA_real_,
      conf.high = NA_real_, method = NA_character_, warnings = "",
      error = msg, stringsAsFactors = FALSE
    ), text = c("WELCH TEST ERROR", msg)
  )
  wilcox <- list(
    row = transform(welch$row, test = "Wilcoxon rank-sum test"),
    text = c("WILCOX TEST ERROR", msg)
  )
}
robust_tests <- bind_rows(welch$row, wilcox$row)
data.table::fwrite(robust_tests,
  file.path(output_dir, "foreign_field_robustness_tests.csv"))
writeLines(c(
  "WELCH T TEST", welch$text, "", "WILCOXON RANK-SUM TEST", wilcox$text
), file.path(output_dir, "foreign_field_robustness_tests.txt"))

# Sensitivity 1: answered-only ordered beta -------------------------------
answered <- data %>%
  filter(!is.na(skipped), !is.na(timed_out), !skipped, !timed_out) %>%
  mutate(score01 = score / 100)
data.table::fwrite(
  answered %>% mutate(across(where(is.factor), as.character)),
  file.path(output_dir, "sensitivity_answered_only_data.csv")
)
answered_h1 <- fit_h1_fallback(
  answered, "score01", ordbeta_family, "answered_only_h1"
)
register_fit(answered_h1, "answered_only_h1", "sensitivity_answered_h1")
answered_h1_emm <- extract_h1_emmeans(
  answered_h1$selected, "sensitivity_answered_h1"
)
answered_foreign <- answered %>% filter(paper_type == "foreign")
answered_h2 <- fit_ri(
  paste0(
    "score01 ~ field_type + question_target + ",
    "(1 | participant_id)"
  ),
  answered_foreign, ordbeta_family, "answered_only_h2"
)
register_fit(answered_h2, "answered_only_h2", "sensitivity_answered_h2")
answered_h2_emm <- extract_h2_emmeans(
  answered_h2$selected, "sensitivity_answered_h2"
)

# Sensitivity 2: binary nonresponse ----------------------------------------
binary <- data %>%
  filter(nonresponse_status_known) %>%
  mutate(nonresponse = as.integer(definite_nonresponse))
data.table::fwrite(
  binary %>% mutate(across(where(is.factor), as.character)),
  file.path(output_dir, "sensitivity_nonresponse_data.csv")
)

binary_feasible <- function(df, min_observations = 10L) {
  reasons <- character()
  if (nrow(df) < min_observations)
    reasons <- c(reasons, sprintf("fewer than %d observations", min_observations))
  if (n_distinct(df$nonresponse) != 2L)
    reasons <- c(reasons, "outcome does not contain both classes")
  if (n_distinct(df$participant_id) < 2L)
    reasons <- c(reasons, "fewer than two participants")
  list(ok = length(reasons) == 0L, reason = paste(reasons, collapse = "; "))
}

binary_h1_feasible <- binary_feasible(binary)
if (binary_h1_feasible$ok) {
  binary_h1 <- fit_h1_fallback(
    binary, "nonresponse", stats::binomial(link = "logit"),
    "nonresponse_h1"
  )
} else {
  binary_h1 <- list(
    selected = NULL,
    attempts = data.frame(
      analysis = "nonresponse_h1", attempt = 0L, structure = "not_fit",
      formula = NA_character_, status = "not_feasible", stable = FALSE,
      nobs = nrow(binary), optimizer_code = NA_integer_,
      optimizer_message = "", pdHess = FALSE, finite_fixed_effects = FALSE,
      random_slope_sd = NA_real_, random_correlation = NA_real_,
      warnings = "", error = "", rejection_reason = binary_h1_feasible$reason,
      stringsAsFactors = FALSE
    )
  )
}
register_fit(binary_h1, "nonresponse_h1", "sensitivity_nonresponse_h1")
binary_h1_emm <- extract_h1_emmeans(
  binary_h1$selected, "sensitivity_nonresponse_h1"
)

binary_foreign <- binary %>% filter(paper_type == "foreign")
binary_h2_feasible <- binary_feasible(binary_foreign)
binary_h2_field_ok <- (
  n_distinct(binary_foreign$field_type, na.rm = TRUE) == 2L
)
binary_h2_reasons <- c(
    binary_h2_feasible$reason,
    if (!binary_h2_field_ok) {
      "field_type does not contain both levels"
    } else {
      character()
    }
)
binary_h2_reasons <- binary_h2_reasons[nzchar(binary_h2_reasons)]
binary_h2_reason <- paste(binary_h2_reasons, collapse = "; ")
binary_h2_all_feasible <- binary_h2_feasible$ok && binary_h2_field_ok
if (binary_h2_all_feasible) {
  binary_h2 <- fit_ri(
    paste0(
      "nonresponse ~ field_type + question_target + ",
      "(1 | participant_id)"
    ),
    binary_foreign, stats::binomial(link = "logit"), "nonresponse_h2"
  )
} else {
  binary_h2 <- list(
    selected = NULL,
    attempts = data.frame(
      analysis = "nonresponse_h2", attempt = 0L, structure = "not_fit",
      formula = NA_character_, status = "not_feasible", stable = FALSE,
      nobs = nrow(binary_foreign), optimizer_code = NA_integer_,
      optimizer_message = "", pdHess = FALSE, finite_fixed_effects = FALSE,
      random_slope_sd = NA_real_, random_correlation = NA_real_,
      warnings = "", error = "", rejection_reason = binary_h2_reason,
      stringsAsFactors = FALSE
    )
  )
}
register_fit(binary_h2, "nonresponse_h2", "sensitivity_nonresponse_h2")
binary_h2_emm <- extract_h2_emmeans(
  binary_h2$selected, "sensitivity_nonresponse_h2"
)

data.table::fwrite(all_attempts, file.path(output_dir, "model_attempts.csv"))
data.table::fwrite(all_diagnostics,
  file.path(output_dir, "model_diagnostics.csv"))

# Overleaf-ready LaTeX tables ----------------------------------------------
latex_escape <- function(x) {
  x <- gsub("\\", "@@BACKSLASH@@", as.character(x), fixed = TRUE)
  x <- gsub("&", "\\&", x, fixed = TRUE)
  x <- gsub("%", "\\%", x, fixed = TRUE)
  x <- gsub("$", "\\$", x, fixed = TRUE)
  x <- gsub("#", "\\#", x, fixed = TRUE)
  x <- gsub("_", "\\_", x, fixed = TRUE)
  x <- gsub("{", "\\{", x, fixed = TRUE)
  x <- gsub("}", "\\}", x, fixed = TRUE)
  x <- gsub("@@BACKSLASH@@", "\\textbackslash{}", x, fixed = TRUE)
  x
}
stars <- function(p) {
  ifelse(is.na(p), "", ifelse(p < .001, "***",
    ifelse(p < .01, "**", ifelse(p < .05, "*", ""))))
}
bold_sig <- function(x, p) {
  ifelse(!is.na(p) & p < .05, paste0("\\textbf{", x, "}"), x)
}
write_kable <- function(x, file, caption, escape = TRUE) {
  writeLines(
    knitr::kable(
      x, format = "latex", booktabs = TRUE, caption = caption,
      escape = escape
    ),
    file.path(latex_dir, file)
  )
}

format_table_p <- function(p) {
  ifelse(
    is.na(p),
    "--",
    ifelse(p < .0001, "\\(<0.0001\\)", sprintf("%.4f", p))
  )
}

format_contrast_estimate <- function(estimate, adjusted_p) {
  rendered <- sprintf("%.3f", estimate)
  marker <- stars(adjusted_p)
  ifelse(
    !is.na(adjusted_p) & adjusted_p < .05,
    paste0("\\(\\mathbf{", rendered, "}^{", marker, "}\\)"),
    paste0("\\(", rendered, "\\)")
  )
}

write_h1_contrast_table <- function(x, file, caption, label) {
  if (!nrow(x)) {
    writeLines(
      c("% Requires \\usepackage{booktabs}", "H1 contrasts unavailable."),
      file.path(latex_dir, file)
    )
    return(invisible(NULL))
  }
  ordered <- x %>%
    mutate(
      question_target = as.character(question_target),
      target_order = match(question_target, target_levels)
    ) %>%
    arrange(target_order)
  rows <- unlist(lapply(seq_len(nrow(ordered)), function(i) {
    c(
      latex_escape(ordered$question_target[[i]]),
      paste0(
        "  & ", format_contrast_estimate(
          ordered$estimate[[i]], ordered$p.value.holm[[i]]
        )
      ),
      paste0("  & ", sprintf("%.3f", ordered$SE[[i]])),
      paste0("  & ", format_table_p(ordered$p.value[[i]])),
      paste0(
        "  & ", format_table_p(ordered$p.value.holm[[i]]), " \\\\"
      )
    )
  }))
  writeLines(c(
    "% Requires \\usepackage{booktabs}",
    "\\begin{table}[h]",
    "\\centering",
    paste0("\\caption{", caption, "}"),
    paste0("\\label{", label, "}"),
    "\\small",
    "\\setlength{\\tabcolsep}{4pt}",
    "\\renewcommand{\\arraystretch}{1.1}",
    "\\begin{tabular*}{\\linewidth}{",
    "  @{\\extracolsep{\\fill}}lrrrr@{}",
    "}",
    "\\toprule",
    "& & & \\multicolumn{2}{c}{\\(p\\)-value} \\\\",
    "\\cmidrule(l){4-5}",
    "Question family & Estimate & SE & Raw & Holm-adjusted \\\\",
    "\\midrule",
    rows,
    "\\bottomrule",
    "\\end{tabular*}",
    "\\end{table}",
    ""
  ), file.path(latex_dir, file))
}

write_h1_means_table <- function(
  x, file, caption, label, foreign_heading = "Foreign paper"
) {
  if (!nrow(x)) {
    writeLines(
      c("% Requires \\usepackage{booktabs}",
        "H1 response means unavailable."),
      file.path(latex_dir, file)
    )
    return(invisible(NULL))
  }
  wide <- x %>%
    transmute(
      question_target = as.character(question_target),
      paper_type = as.character(paper_type),
      mean = response_score,
      interval = sprintf("[%.2f, %.2f]", lower_score, upper_score)
    ) %>%
    pivot_wider(
      names_from = paper_type,
      values_from = c(mean, interval),
      names_glue = "{.value}_{paper_type}"
    ) %>%
    mutate(target_order = match(question_target, target_levels)) %>%
    arrange(target_order)
  rows <- unlist(lapply(seq_len(nrow(wide)), function(i) {
    c(
      latex_escape(wide$question_target[[i]]),
      paste0("  & ", sprintf("%.2f", wide$mean_foreign[[i]])),
      paste0("  & ", wide$interval_foreign[[i]]),
      paste0("  & ", sprintf("%.2f", wide$mean_own[[i]])),
      paste0("  & ", wide$interval_own[[i]], " \\\\")
    )
  }))
  writeLines(c(
    "% Requires \\usepackage{booktabs}",
    "\\begin{table}[h]",
    "\\centering",
    paste0("\\caption{", caption, "}"),
    paste0("\\label{", label, "}"),
    "\\small",
    "\\setlength{\\tabcolsep}{4pt}",
    "\\renewcommand{\\arraystretch}{1.1}",
    "\\begin{tabular*}{\\linewidth}{",
    "  @{\\extracolsep{\\fill}}lrlrl@{}",
    "}",
    "\\toprule",
    paste0("& \\multicolumn{2}{c}{", foreign_heading, "}"),
    "& \\multicolumn{2}{c}{Own paper} \\\\",
    "\\cmidrule(lr){2-3}\\cmidrule(l){4-5}",
    "Question family & Mean & 95\\% CI & Mean & 95\\% CI \\\\",
    "\\midrule",
    rows,
    "\\bottomrule",
    "\\end{tabular*}",
    "\\end{table}",
    ""
  ), file.path(latex_dir, file))
}

write_h2_means_table <- function(x, file) {
  if (!nrow(x)) {
    writeLines(
      c("% Requires \\usepackage{booktabs}", "H2 response means unavailable."),
      file.path(latex_dir, file)
    )
    return(invisible(NULL))
  }
  ordered <- x %>%
    mutate(
      field_type = as.character(field_type),
      field_order = match(field_type, c("out_field", "in_field"))
    ) %>%
    arrange(field_order)
  field_labels <- c(
    out_field = "Out-of-field",
    in_field = "In-field"
  )
  rows <- vapply(seq_len(nrow(ordered)), function(i) {
    paste0(
      field_labels[[ordered$field_type[[i]]]],
      " & ", sprintf("%.2f", ordered$response_score[[i]]),
      " & ", sprintf(
        "[%.2f, %.2f]",
        ordered$lower_score[[i]], ordered$upper_score[[i]]
      ),
      " \\\\"
    )
  }, character(1))
  writeLines(c(
    "% Requires \\usepackage{booktabs}",
    "\\begin{table}[h]",
    "\\centering",
    paste0(
      "\\caption{Estimated marginal mean scores for $\\mathrm{H}_2$ on ",
      "unfamiliar papers by whether their field matches that of the participant. ",
      "Scores are reported on a 0--100 scale, with 95\\% confidence intervals ",
      "(CIs).}"
    ),
    "\\label{tab:h2-foreign-paper-marginal-means}",
    "\\small",
    "\\setlength{\\tabcolsep}{4pt}",
    "\\renewcommand{\\arraystretch}{1.1}",
    "\\begin{tabular*}{\\linewidth}{",
    "  @{\\extracolsep{\\fill}}lrl@{}",
    "}",
    "\\toprule",
    "Field match & Mean & 95\\% CI \\\\",
    "\\midrule",
    rows,
    "\\bottomrule",
    "\\end{tabular*}",
    "\\end{table}",
    ""
  ), file.path(latex_dir, file))
}

write_h2_contrast_table <- function(x, file) {
  if (!nrow(x)) {
    writeLines(
      c("% Requires \\usepackage{booktabs}", "H2 contrast unavailable."),
      file.path(latex_dir, file)
    )
    return(invisible(NULL))
  }
  writeLines(c(
    "% Requires \\usepackage{booktabs}",
    "",
    "\\begin{table}[h]",
    "\\centering",
    paste0(
      "\\caption{$\\mathrm{H}_2$ in-field vs. out-field contrast on the model's ",
      "link scale for unfamiliar papers. A positive estimate indicates higher ",
      "scores for in-field papers.}"
    ),
    "\\label{tab:h2-field-contrast}",
    "\\small",
    "\\setlength{\\tabcolsep}{4pt}",
    "\\renewcommand{\\arraystretch}{1.1}",
    "\\begin{tabular*}{\\linewidth}{",
    "  @{\\extracolsep{\\fill}}rrr@{}",
    "}",
    "\\toprule",
    "Estimate & SE & \\(p\\)-value \\\\",
    "\\midrule",
    paste0(
      sprintf("%.3f", x$estimate[[1]]), " & ",
      sprintf("%.3f", x$SE[[1]]), " & ",
      format_table_p(x$p.value[[1]]), " \\\\"
    ),
    "\\bottomrule",
    "\\end{tabular*}",
    "\\end{table}",
    ""
  ), file.path(latex_dir, file))
}

format_descriptive_row <- function(label, row) {
  paste0(
    label,
    " & ", sprintf("%d", as.integer(row$n[[1]])),
    " & ", sprintf("%.2f", row$mean[[1]]),
    " & ", sprintf("%.2f", row$sd[[1]]),
    " & ", sprintf("%.1f", row$median[[1]]),
    " & ", sprintf("%.1f", 100 * row$zero_rate[[1]]),
    " & ", sprintf("%.1f", 100 * row$one_rate[[1]]),
    " & ", sprintf("%.1f", 100 * row$nonresponse_rate[[1]]),
    " \\\\"
  )
}

write_descriptives_table <- function(file) {
  paper_rows <- descriptive_paper %>%
    mutate(
      paper_type = as.character(paper_type),
      paper_order = match(paper_type, c("foreign", "own"))
    ) %>%
    arrange(paper_order)
  category_rows <- descriptive_category %>%
    mutate(
      question_target = as.character(question_target),
      target_order = match(question_target, target_levels)
    ) %>%
    arrange(target_order)
  paper_category_rows <- descriptive_paper_category %>%
    mutate(
      paper_type = as.character(paper_type),
      question_target = as.character(question_target),
      paper_order = match(paper_type, c("foreign", "own")),
      target_order = match(question_target, target_levels)
    ) %>%
    arrange(paper_order, target_order)
  paper_labels <- c(foreign = "Foreign paper", own = "Own paper")

  rows <- c(
    format_descriptive_row("Overall", descriptive_overall),
    "",
    "\\addlinespace",
    "\\multicolumn{8}{@{}l}{\\textit{By paper ownership}} \\\\",
    vapply(seq_len(nrow(paper_rows)), function(i) {
      format_descriptive_row(
        paste0("\\quad ", paper_labels[[paper_rows$paper_type[[i]]]]),
        paper_rows[i, ]
      )
    }, character(1)),
    "",
    "\\addlinespace",
    "\\multicolumn{8}{@{}l}{\\textit{By question category}} \\\\",
    vapply(seq_len(nrow(category_rows)), function(i) {
      format_descriptive_row(
        paste0("\\quad ", latex_escape(category_rows$question_target[[i]])),
        category_rows[i, ]
      )
    }, character(1))
  )
  for (paper in c("foreign", "own")) {
    selected <- paper_category_rows %>% filter(paper_type == paper)
    rows <- c(
      rows,
      "",
      "\\addlinespace",
      paste0(
        "\\multicolumn{8}{@{}l}{\\textit{",
        paper_labels[[paper]],
        ", by question category}} \\\\"
      ),
      vapply(seq_len(nrow(selected)), function(i) {
        format_descriptive_row(
          paste0("\\quad ", latex_escape(selected$question_target[[i]])),
          selected[i, ]
        )
      }, character(1))
    )
  }

  writeLines(c(
    "% Requires \\usepackage{booktabs}",
    "",
    "\\begin{table}[h]",
    "\\centering",
    paste0(
      "\\caption{Descriptive metrics of question-scores overall, grouped by ",
      "paper ownership and by question category. Scores range from 0 to 100. ",
      "For every group, the total number of observations equals \\(n\\), and no ",
      "scores are missing. Zero, Full, and Nonresponse denote the percentages ",
      "of observations with a score of 0, a score of 100, and no response, ",
      "respectively.}"
    ),
    "\\label{tab:question-score-descriptives}",
    "\\small",
    "\\setlength{\\tabcolsep}{4pt}",
    "\\renewcommand{\\arraystretch}{1.1}",
    "\\begin{tabular*}{\\linewidth}{",
    "  @{\\extracolsep{\\fill}}lrrrrrrr@{}",
    "}",
    "\\toprule",
    "& & \\multicolumn{3}{c}{Score}",
    "  & \\multicolumn{3}{c}{Rate (\\%)} \\\\",
    "\\cmidrule(lr){3-5}\\cmidrule(l){6-8}",
    "Group & \\(n\\) & Mean & SD & Median",
    "      & Zero & Full & Nonresponse \\\\",
    "\\midrule",
    rows,
    "\\bottomrule",
    "\\end{tabular*}",
    "\\end{table}",
    ""
  ), file.path(latex_dir, file))
}

write_descriptives_table("descriptives.tex")

write_h1_means_table(
  h1_emm$response,
  "h1_response_means.tex",
  paste0(
    "Estimated marginal mean scores for $\\mathrm{H}_1$ by question family and ",
    "paper ownership. Scores are reported on a 0--100 scale, with 95\\% ",
    "confidence intervals (CIs)."
  ),
  "tab:h1-estimated-marginal-means"
)

write_h1_contrast_table(
  h1_emm$contrasts,
  "h1_contrasts.tex",
  paste0(
    "Contrasts calculated for $\\mathrm{H}_1$ between own vs. unfamiliar paper ",
    "conditions on the model's link scale. Positive estimates indicate higher ",
    "scores for own papers. We apply Holm adjustment across the four contrasts. ",
    "Bold estimates and stars indicate significance using the Holm-adjusted ",
    "\\(p\\)-values: \\({}^{***}p<.001\\), \\({}^{**}p<.01\\), ",
    "\\({}^{*}p<.05\\)."
  ),
  "tab:h1-own-foreign-contrasts"
)

write_h1_means_table(
  answered_h1_emm$response,
  "sensitivity_answered_h1_response_means.tex",
  paste0(
    "Estimated marginal mean scores for $\\mathrm{H}_1$ using questions that ",
    "were answered only, grouped by question family and paper ownership. Scores ",
    "are reported on a 0--100 scale, with 95\\% confidence intervals (CIs)."
  ),
  "tab:h1-answered-only-marginal-means",
  foreign_heading = "Unfamiliar paper"
)

write_h1_contrast_table(
  answered_h1_emm$contrasts,
  "sensitivity_answered_h1_contrasts.tex",
  paste0(
    "Contrasts calculated for $\\mathrm{H}_1$ between own vs. unfamiliar paper ",
    "conditions on the model's link scale but using answered questions only. ",
    "Skipped, timed-out, and unknown-status questions are excluded. Positive ",
    "estimates indicate higher scores for own papers. Holm adjustment is applied ",
    "across the four contrasts. Bold estimates and stars indicate significance ",
    "using Holm-adjusted \\(p\\)-values: \\({}^{***}p<.001\\), ",
    "\\({}^{**}p<.01\\), \\({}^{*}p<.05\\)."
  ),
  "tab:sensitivity_answered_h1_contrasts"
)

write_h2_means_table(h2_emm$response, "h2_response_means.tex")
write_h2_contrast_table(h2_emm$contrast, "h2_contrast.tex")

robust_latex <- robust_tests %>%
  transmute(
    Test = latex_escape(test), Status = latex_escape(status),
    Statistic = round(statistic, 3), `p-value` = round(p.value, 4),
    `95\\% CI` = ifelse(
      is.na(conf.low), latex_escape(error),
      sprintf("[%.3f, %.3f]", conf.low, conf.high)
    )
  )
write_kable(robust_latex, "robustness_tests.tex",
  "Participant-level foreign-field robustness tests", escape = FALSE)

writeLines(c(
  "% Requires \\usepackage{booktabs}",
  "\\input{latex/descriptives.tex}",
  "\\input{latex/h1_response_means.tex}",
  "\\input{latex/h1_contrasts.tex}",
  "\\input{latex/sensitivity_answered_h1_response_means.tex}",
  "\\input{latex/sensitivity_answered_h1_contrasts.tex}",
  "\\input{latex/h2_response_means.tex}",
  "\\input{latex/h2_contrast.tex}",
  "\\input{latex/robustness_tests.tex}"
), file.path(latex_dir, "all_tables.tex"))

status_of <- function(result) {
  if (is.null(result$selected)) "no_stable_fit" else "stable"
}
write_summary(list(
  status = "analysis_completed",
  input_rows = nrow(data),
  participants = n_distinct(data$participant_id),
  observed_primary_scores = sum(!is.na(data$score_analysis)),
  missing_primary_scores = sum(is.na(data$score_analysis)),
  known_response_status_rows = sum(data$nonresponse_status_known),
  known_nonresponses = sum(data$definite_nonresponse),
  foreign_field_counts = as.list(table(foreign_participant$field_type)),
  warning_count = sum(issues$severity == "warning"),
  primary = list(
    h1_status = status_of(h1),
    h1_selected_structure = if (is.null(h1$selected)) NULL
      else h1$selected$structure,
    h1_selected_formula = if (is.null(h1$selected)) NULL
      else h1$selected$formula,
    h1_emmeans_error = h1_emm$error,
    h2_status = status_of(h2),
    h2_emmeans_error = h2_emm$error
  ),
  sensitivity_answered_only = list(
    rows = nrow(answered), h1_status = status_of(answered_h1),
    h1_selected_structure = if (is.null(answered_h1$selected)) NULL
      else answered_h1$selected$structure,
    h1_emmeans_error = answered_h1_emm$error,
    h2_status = status_of(answered_h2),
    h2_emmeans_error = answered_h2_emm$error
  ),
  sensitivity_nonresponse = list(
    known_flag_rows = nrow(binary),
    h1_feasible = binary_h1_feasible$ok,
    h1_feasibility_reason = binary_h1_feasible$reason,
    h1_status = status_of(binary_h1),
    h1_selected_structure = if (is.null(binary_h1$selected)) NULL
      else binary_h1$selected$structure,
    h1_emmeans_error = binary_h1_emm$error,
    h2_feasible = binary_h2_all_feasible,
    h2_feasibility_reason = binary_h2_reason,
    h2_status = status_of(binary_h2),
    h2_emmeans_error = binary_h2_emm$error
  ),
  robustness_tests = as.list(setNames(robust_tests$status, robust_tests$test)),
  interpretation_note = paste0(
    "A nonsignificant H2 result means that no field effect was detected; ",
    "it is not evidence of equivalence."
  )
))

message(
  "Final ordered-beta workflow complete. Results: ",
  normalizePath(output_dir, mustWork = TRUE)
)
