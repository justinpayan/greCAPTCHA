#!/usr/bin/env Rscript

# Fit a four-feature authorship logistic regression with participant-clustered
# robust standard errors.

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

analysis_mode <- Sys.getenv(
  "RESEARCH_CAPTCHA_FOUR_FEATURE_MODE",
  unset = "overall_summaries"
)
type_score_mode <- identical(analysis_mode, "question_type_scores")
if (!analysis_mode %in% c("overall_summaries", "question_type_scores")) {
  stop("Unknown four-feature analysis mode: ", analysis_mode, call. = FALSE)
}
script_name <- if (type_score_mode) {
  "analyze_type_score_logistic.R"
} else {
  "analyze_four_feature_logistic.R"
}
default_output_dir <- if (type_score_mode) {
  "type_score_logistic_output"
} else {
  "four_feature_logistic_output"
}
model_label <- if (type_score_mode) {
  "Question-type score"
} else {
  "Four-feature"
}

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1 || length(args) > 2) {
  stop(
    "Usage: Rscript scripts/analysis/", script_name, " ",
    "<private.csv-or-tsv> [output-directory]",
    call. = FALSE
  )
}
input_path <- normalizePath(args[[1]], mustWork = TRUE)
output_dir <- if (length(args) == 2) args[[2]] else default_output_dir
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
latex_dir <- file.path(output_dir, "latex")
dir.create(latex_dir, recursive = TRUE, showWarnings = FALSE)

required_columns <- c(
  "participant_id", "paper_order", "paper_position", "position",
  "score", "skipped", "timed_out"
)
if (type_score_mode) {
  required_columns <- c(required_columns, "question_target")
} else {
  required_columns <- c(required_columns, "duration_ms")
}
target_levels <- c(
  "Planted error", "Unstated rationale", "Background knowledge", "Failure mode"
)
target_keys <- c(
  "planted_error", "unstated_rationale", "background_knowledge", "failure_mode"
)
features <- if (type_score_mode) {
  paste0("mean_score_", target_keys)
} else {
  c("mean_score", "mean_duration", "skipped_count", "timeout_count")
}
issues <- data.frame(
  check = character(), input_row = integer(), participant_id = character(),
  paper_id = integer(), message = character(), stringsAsFactors = FALSE
)
add_issue <- function(
    check, message, input_row = NA_integer_, participant_id = NA_character_,
    paper_id = NA_integer_) {
  issues <<- bind_rows(
    issues,
    data.frame(
      check = check, input_row = as.integer(input_row),
      participant_id = as.character(participant_id),
      paper_id = as.integer(paper_id), message = as.character(message),
      stringsAsFactors = FALSE
    )
  )
}
write_validation <- function(checks) {
  data.table::fwrite(checks, file.path(output_dir, "validation_report.csv"))
  data.table::fwrite(issues, file.path(output_dir, "invalid_rows.csv"))
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
      rows[[index]]
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
      rows[[index]]
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
    paste("Duplicate normalized columns:", paste(duplicate_names, collapse = ", "))
  )
}
names(raw) <- make.unique(normalized_names)
missing_columns <- setdiff(required_columns, names(raw))
if (length(missing_columns) > 0) {
  add_issue(
    "required_columns",
    paste("Missing columns:", paste(missing_columns, collapse = ", "))
  )
}
if (nrow(raw) == 0) {
  add_issue("nonempty_input", "Input contains no data rows.")
}
if (nrow(issues) > 0) {
  checks <- data.frame(
    check = c("unique_columns", "required_columns", "nonempty_input"),
    passed = c(
      length(duplicate_names) == 0,
      length(missing_columns) == 0,
      nrow(raw) > 0
    ),
    stringsAsFactors = FALSE
  )
  write_validation(checks)
  jsonlite::write_json(
    list(status = "validation_failed", validation_checks = checks),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE
  )
  stop("Input validation failed; see output files.", call. = FALSE)
}

data <- raw %>%
  mutate(
    input_row = row_number() + 1L,
    participant_id = trimws(as.character(participant_id)),
    paper_order = normalize_text(paper_order)
  )
if (type_score_mode) {
  data <- data %>%
    mutate(
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
}
data$paper_position <- parse_numeric(
  data$paper_position, "paper_position", data$input_row, integer_only = TRUE
)
data$position <- parse_numeric(
  data$position, "position", data$input_row, integer_only = TRUE
)
if (!type_score_mode) {
  data$duration_ms <- parse_numeric(
    data$duration_ms, "duration_ms", data$input_row
  )
}
if (type_score_mode) {
  score_source <- data$score
  data$score <- suppressWarnings(
    as.numeric(trimws(as.character(data$score)))
  )
} else {
  data$score <- parse_numeric(data$score, "score", data$input_row)
}
data$skipped <- parse_boolean(data$skipped, "skipped", data$input_row)
data$timed_out <- parse_boolean(data$timed_out, "timed_out", data$input_row)

if (type_score_mode) {
  invalid_score <- is.na(data$score) | !is.finite(data$score)
  required_score <- data$skipped == 0L & data$timed_out == 0L
  for (index in which(invalid_score & required_score)) {
    add_issue(
      "numeric_parse",
      sprintf(
        "Missing or invalid score value '%s' on an included question.",
        score_source[[index]]
      ),
      data$input_row[[index]]
    )
  }
  data$score[which(data$skipped == 1L)] <- 0
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
if (type_score_mode) {
  for (index in which(is.na(data$question_target))) {
    add_issue(
      "question_target",
      sprintf(
        "Unrecognized question_target '%s'.",
        data$question_target_source[[index]]
      ),
      data$input_row[[index]], data$participant_id[[index]],
      data$paper_position[[index]]
    )
  }
}
if (!type_score_mode) {
  for (index in which(!is.na(data$duration_ms) & data$duration_ms < 0)) {
    add_issue(
      "duration_range", "duration_ms must be nonnegative.",
      data$input_row[[index]], data$participant_id[[index]],
      data$paper_position[[index]]
    )
  }
}
score_used <- if (type_score_mode) {
  data$skipped == 0L & data$timed_out == 0L
} else {
  rep(TRUE, nrow(data))
}
for (index in which(
  score_used & !is.na(data$score) & (data$score < 0 | data$score > 100)
)) {
  add_issue(
    "score_range", "score must be between 0 and 100.",
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
  mutate(completed = skipped == 0L & timed_out == 0L)

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
      "unique_question_positions",
      sprintf("Expected positions 1-8; found %s.", paste(positions, collapse = ", ")),
      participant_id = participant_id, paper_id = paper_id
    )
  }
  if (type_score_mode) {
    type_counts <- table(
      factor(rows$question_target, levels = target_levels)
    )
    if (any(type_counts != 2L)) {
      add_issue(
        "two_questions_per_type",
        paste(
          names(type_counts), as.integer(type_counts),
          sep = "=", collapse = "; "
        ),
        participant_id = participant_id, paper_id = paper_id
      )
    }
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
    "required_values", "two_tests_per_participant", "eight_questions_per_test",
    "unique_question_positions", "first_paper_order", "test_paper_order",
    "mutually_exclusive_status", "measurement_ranges"
  ),
  passed = c(
    !any(issues$check %in% c(
      "boolean_parse", "numeric_parse", "participant_id", "paper_order",
      "paper_position", "position"
    )),
    !any(issues$check == "two_tests_per_participant"),
    !any(issues$check == "eight_questions_per_test"),
    !any(issues$check == "unique_question_positions"),
    !any(issues$check == "first_paper_order"),
    !any(issues$check == "test_paper_order"),
    !any(issues$check == "mutually_exclusive_status"),
    !any(issues$check %in% c("duration_range", "score_range"))
  ),
  stringsAsFactors = FALSE
)
if (type_score_mode) {
  validation_checks <- bind_rows(
    validation_checks,
    data.frame(
      check = c("recognized_question_types", "two_questions_per_type"),
      passed = c(
        !any(issues$check == "question_target"),
        !any(issues$check == "two_questions_per_type")
      ),
      stringsAsFactors = FALSE
    )
  )
}
write_validation(validation_checks)
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
  stop("Validation failed; model was not fit.", call. = FALSE)
}

first_paper <- data %>%
  filter(paper_position == 1L) %>%
  distinct(participant_id, first_paper_type = paper_order)
authorship_rows <- data %>%
  left_join(first_paper, by = "participant_id") %>%
  mutate(
    paper_id = paper_position,
    Authorship = ifelse(
      (paper_position == 1L & first_paper_type == "own") |
        (paper_position == 2L & first_paper_type == "foreign"),
      1L, 0L
    )
  )
if (type_score_mode) {
  test_level_data <- authorship_rows %>%
    mutate(
      question_key = target_keys[match(question_target, target_levels)],
      score_for_mean = ifelse(skipped == 1L, 0, score)
    ) %>%
    group_by(participant_id, paper_id, Authorship, question_key) %>%
    summarise(
      included_question_count = sum(timed_out == 0L),
      mean_score = ifelse(
        included_question_count == 0L,
        0,
        mean(score_for_mean[timed_out == 0L])
      ),
      .groups = "drop"
    ) %>%
    select(-included_question_count) %>%
    pivot_wider(
      names_from = question_key,
      values_from = mean_score,
      names_prefix = "mean_score_"
    ) %>%
    arrange(participant_id, paper_id)
} else {
  test_level_data <- authorship_rows %>%
    group_by(participant_id, paper_id, Authorship) %>%
    summarise(
      completed_count = sum(completed),
      mean_score = ifelse(
        completed_count == 0L, 0, mean(score[completed])
      ),
      mean_duration = ifelse(
        completed_count == 0L, 0, mean(duration_ms[completed])
      ),
      skipped_count = sum(skipped == 1L),
      timeout_count = sum(timed_out == 1L),
      .groups = "drop"
    ) %>%
    arrange(participant_id, paper_id)
}

pair_checks <- test_level_data %>%
  group_by(participant_id) %>%
  summarise(
    tests = n(),
    own = sum(Authorship == 1L),
    foreign = sum(Authorship == 0L),
    valid = tests == 2L && own == 1L && foreign == 1L,
    .groups = "drop"
  )
aggregate_valid <- (
  !anyDuplicated(test_level_data[c("participant_id", "paper_id")]) &&
    all(pair_checks$valid) &&
    !anyNA(test_level_data[features]) &&
    (
      type_score_mode ||
        (
          all(
            test_level_data$skipped_count >= 0 &
              test_level_data$skipped_count <= 8
          ) &&
            all(
              test_level_data$timeout_count >= 0 &
                test_level_data$timeout_count <= 8
            )
        )
    )
)
if (!aggregate_valid) {
  jsonlite::write_json(
    list(status = "validation_failed", reason = "aggregate_validation"),
    file.path(output_dir, "analysis_summary.json"),
    pretty = TRUE, auto_unbox = TRUE
  )
  stop("Aggregate table validation failed.", call. = FALSE)
}
data.table::fwrite(
  test_level_data,
  file.path(
    output_dir,
    if (type_score_mode) {
      "type_score_test_level_data.csv"
    } else {
      "four_feature_test_level_data.csv"
    }
  )
)

scaling_parameters <- data.frame(
  feature = features,
  mean = vapply(features, function(feature) {
    mean(test_level_data[[feature]])
  }, numeric(1)),
  standard_deviation = vapply(features, function(feature) {
    stats::sd(test_level_data[[feature]])
  }, numeric(1)),
  stringsAsFactors = FALSE
)
data.table::fwrite(
  scaling_parameters,
  file.path(output_dir, "scaling_parameters.csv")
)
model_data <- test_level_data
for (feature in features) {
  feature_mean <- scaling_parameters$mean[
    scaling_parameters$feature == feature
  ]
  feature_sd <- scaling_parameters$standard_deviation[
    scaling_parameters$feature == feature
  ]
  if (!is.na(feature_sd) && feature_sd > 0) {
    model_data[[feature]] <- (
      model_data[[feature]] - feature_mean
    ) / feature_sd
  }
}

model_formula <- stats::reformulate(features, response = "Authorship")
formula_text <- paste(
  "Authorship ~", paste(features, collapse = " + ")
)
writeLines(formula_text, file.path(output_dir, "model_formula.txt"))
model_matrix <- stats::model.matrix(model_formula, data = model_data)
matrix_rank <- qr(model_matrix)$rank
nominal_coefficients <- ncol(model_matrix)
matrix_variance <- apply(model_matrix, 2, stats::var)
matrix_diagnostics <- data.frame(
  column = colnames(model_matrix),
  variance = as.numeric(matrix_variance),
  zero_variance = as.numeric(matrix_variance) == 0,
  stringsAsFactors = FALSE
)
data.table::fwrite(
  matrix_diagnostics,
  file.path(output_dir, "model_matrix_diagnostics.csv")
)

separation_fit <- tryCatch(
  stats::glm(
    model_formula,
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

fit_error <- NULL
fit_warnings <- character()
model <- NULL
cluster_count <- n_distinct(model_data$participant_id)
if (cluster_count < 2L) {
  fit_error <- "At least two participant clusters are required."
} else if (matrix_rank < nominal_coefficients) {
  fit_error <- sprintf(
    "Model matrix is rank deficient: rank %d of %d.",
    matrix_rank, nominal_coefficients
  )
} else if (separation_status == "separation_detected") {
  fit_error <- "Separation detected; logistic regression was not fit."
} else if (separation_status == "diagnostic_failed") {
  fit_error <- paste(
    "Separation diagnostic failed; logistic regression was not fit:",
    separation_details
  )
} else {
  model <- tryCatch(
    withCallingHandlers(
      stats::glm(
        model_formula,
        data = model_data,
        family = stats::binomial(),
        na.action = stats::na.fail
      ),
      warning = function(warning) {
        fit_warnings <<- c(fit_warnings, conditionMessage(warning))
        invokeRestart("muffleWarning")
      }
    ),
    error = function(error) {
      fit_error <<- conditionMessage(error)
      NULL
    }
  )
}

empty_coefficients <- function() {
  data.frame(
    term = character(), estimate = numeric(), std.error = numeric(),
    statistic = numeric(), p.value = numeric(), conf.low = numeric(),
    conf.high = numeric(), odds_ratio = numeric(), odds_ratio_low = numeric(),
    odds_ratio_high = numeric(), stringsAsFactors = FALSE
  )
}
cluster_df <- cluster_count - 1L
if (is.null(model)) {
  coefficients <- empty_coefficients()
  robust_covariance <- NULL
  clustered_test <- NULL
  model_status <- "fit_failed"
  glm_converged <- FALSE
  observations_used <- 0L
  fit_metrics <- list()
} else {
  robust_covariance <- tryCatch(
    sandwich::vcovCL(
      model,
      cluster = model_data$participant_id,
      type = "HC1",
      cadjust = TRUE
    ),
    error = function(error) {
      fit_error <<- conditionMessage(error)
      NULL
    }
  )
  if (is.null(robust_covariance)) {
    coefficients <- empty_coefficients()
    clustered_test <- NULL
  } else {
    clustered_test <- lmtest::coeftest(
      model, vcov. = robust_covariance, df = cluster_df
    )
    estimate <- as.numeric(clustered_test[, 1])
    std_error <- as.numeric(clustered_test[, 2])
    critical <- stats::qt(0.975, df = cluster_df)
    conf_low <- estimate - critical * std_error
    conf_high <- estimate + critical * std_error
    coefficients <- data.frame(
      term = rownames(clustered_test),
      estimate = estimate,
      std.error = std_error,
      statistic = as.numeric(clustered_test[, 3]),
      p.value = as.numeric(clustered_test[, 4]),
      conf.low = conf_low,
      conf.high = conf_high,
      odds_ratio = exp(estimate),
      odds_ratio_low = exp(conf_low),
      odds_ratio_high = exp(conf_high),
      stringsAsFactors = FALSE
    )
  }
  glm_converged <- isTRUE(model$converged)
  observations_used <- stats::nobs(model)
  probability <- stats::predict(model, type = "response")
  observed <- model_data$Authorship
  positives <- sum(observed == 1L)
  negatives <- sum(observed == 0L)
  ranks <- rank(probability, ties.method = "average")
  auc <- (
    sum(ranks[observed == 1L]) - positives * (positives + 1) / 2
  ) / (positives * negatives)
  fit_metrics <- list(
    null_deviance = model$null.deviance,
    residual_deviance = model$deviance,
    aic = stats::AIC(model),
    mcfadden_pseudo_r_squared = 1 - model$deviance / model$null.deviance,
    roc_auc = auc,
    brier_score = mean((probability - observed)^2),
    accuracy = mean((probability >= 0.5) == observed)
  )
  model_status <- if (
    !glm_converged || length(fit_warnings) > 0 ||
      is.null(robust_covariance) ||
      separation_status == "diagnostic_failed"
  ) {
    "fit_completed_with_warnings"
  } else {
    "fit_completed"
  }
}

summary_text <- if (is.null(model)) {
  c("MODEL UNAVAILABLE", fit_error, fit_warnings)
} else {
  c(
    capture.output(summary(model)),
    "",
    paste0("Participant-clustered tests (df = ", cluster_df, "):"),
    if (is.null(clustered_test)) {
      "UNAVAILABLE"
    } else {
      capture.output(print(clustered_test))
    },
    "", "Captured warnings:", fit_warnings
  )
}
writeLines(summary_text, file.path(output_dir, "model_summary.txt"))
data.table::fwrite(coefficients, file.path(output_dir, "fixed_effects.csv"))

diagnostics <- data.frame(
  diagnostic = c(
    "model_status", "test_level_observations", "participants",
    "nominal_coefficients", "model_matrix_rank", "separation_status",
    "separation_details", "cluster_count", "cluster_degrees_of_freedom",
    "glm_converged", "observations_used", "captured_warnings", "fit_error"
  ),
  value = c(
    model_status, nrow(test_level_data), cluster_count,
    nominal_coefficients, matrix_rank, separation_status,
    separation_details, cluster_count, cluster_df, glm_converged,
    observations_used, paste(fit_warnings, collapse = " | "),
    ifelse(is.null(fit_error), "", fit_error)
  ),
  stringsAsFactors = FALSE
)
data.table::fwrite(diagnostics, file.path(output_dir, "model_diagnostics.csv"))

fit_metrics_frame <- if (length(fit_metrics) == 0) {
  data.frame(metric = character(), value = numeric())
} else {
  data.frame(
    metric = names(fit_metrics),
    value = unlist(fit_metrics, use.names = FALSE),
    stringsAsFactors = FALSE
  )
}
data.table::fwrite(
  fit_metrics_frame,
  file.path(output_dir, "in_sample_fit_metrics.csv")
)

fixed_for_latex <- if (nrow(coefficients) == 0) {
  data.frame(Result = "Model unavailable; see model\\_diagnostics.csv.")
} else {
  significance_stars <- ifelse(
    coefficients$p.value < 0.001, "***",
    ifelse(
      coefficients$p.value < 0.01, "**",
      ifelse(coefficients$p.value < 0.05, "*", "")
    )
  )
  bold_if_significant <- function(values) {
    ifelse(
      coefficients$p.value < 0.05,
      paste0("\\textbf{", values, "}"),
      values
    )
  }
  coefficients %>%
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
}
fixed_latex_table <- knitr::kable(
  fixed_for_latex,
  format = "latex", booktabs = TRUE, escape = FALSE,
  caption = paste(
    model_label,
    "logistic regression with participant-clustered standard errors"
  )
)
if (nrow(coefficients) > 0) {
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
writeLines(
  knitr::kable(
    fit_metrics_frame,
    format = "latex", booktabs = TRUE,
    caption = paste(model_label, "logistic-regression in-sample fit"),
    col.names = c("Metric", "Value")
  ),
  file.path(latex_dir, "in_sample_fit.tex")
)
writeLines(
  c(
    "% Required package: booktabs",
    "\\input{latex/fixed_effects.tex}",
    "\\input{latex/in_sample_fit.tex}"
  ),
  file.path(latex_dir, "all_tables.tex")
)

jsonlite::write_json(
  list(
    status = model_status,
    formula = formula_text,
    validation_checks = validation_checks,
    test_level_observations = nrow(test_level_data),
    participants = cluster_count,
    analysis_mode = analysis_mode,
    skipped_score_treatment = if (type_score_mode) {
      "Included as score zero"
    } else {
      "Excluded from completed-question means"
    },
    timed_out_score_treatment = if (type_score_mode) {
      "Excluded from each question-type mean"
    } else {
      "Excluded from completed-question means"
    },
    standardized_features = features,
    cluster_degrees_of_freedom = cluster_df,
    separation_screen = list(
      status = separation_status,
      details = separation_details
    ),
    glm_converged = glm_converged,
    observations_used = observations_used,
    fit_metrics = fit_metrics,
    captured_warnings = fit_warnings,
    fit_error = if (is.null(fit_error)) "" else fit_error
  ),
  file.path(output_dir, "analysis_summary.json"),
  pretty = TRUE, auto_unbox = TRUE, na = "null"
)

message(
  model_label, " analysis complete. Status: ", model_status,
  ". Results: ", normalizePath(output_dir, mustWork = TRUE)
)
