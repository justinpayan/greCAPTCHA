#!/usr/bin/env Rscript

# Run the four-predictor authorship model using one adjusted mean score for
# each question type. Skipped questions score zero; timed-out questions are
# excluded from the corresponding mean.

command_args <- commandArgs(trailingOnly = FALSE)
file_argument <- command_args[grepl("^--file=", command_args)]
if (length(file_argument) != 1L) {
  stop("Could not determine this script's directory.", call. = FALSE)
}
script_path <- normalizePath(
  sub("^--file=", "", file_argument[[1]]),
  mustWork = TRUE
)

Sys.setenv(
  RESEARCH_CAPTCHA_FOUR_FEATURE_MODE = "question_type_scores"
)
source(
  file.path(dirname(script_path), "analyze_four_feature_logistic.R"),
  chdir = FALSE
)
