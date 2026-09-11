#!/usr/bin/env Rscript

packages <- c(
  "data.table",
  "dplyr",
  "tidyr",
  "lme4",
  "broom.mixed",
  "jsonlite",
  "detectseparation",
  "knitr",
  "sandwich",
  "lmtest",
  "glmmTMB",
  "emmeans",
  "ggplot2"
)

user_library <- Sys.getenv("R_LIBS_USER")
dir.create(user_library, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(user_library, .libPaths()))

missing_packages <- packages[
  !vapply(packages, requireNamespace, logical(1), quietly = TRUE)
]

if (length(missing_packages) == 0) {
  message("All mixed-effects analysis packages are already installed.")
} else {
  message("Installing: ", paste(missing_packages, collapse = ", "))
  install.packages(
    missing_packages,
    lib = user_library,
    repos = "https://cloud.r-project.org"
  )
}
