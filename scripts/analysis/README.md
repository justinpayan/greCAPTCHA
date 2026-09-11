# Paper authorship and performance analysis

The final primary workflow is a question-level ordered-beta analysis of
performance on own versus foreign papers. Earlier authorship-prediction
scripts are retained as legacy exploratory analyses:

1. The final R analysis models question scores and tests the preregistered H1
   and H2 performance comparisons.
2. A Python logistic regression with participant-grouped k-fold
   cross-validation estimates held-out predictive performance from 24
   aggregate test features.
3. A legacy R logistic regression pools features within the four
   question types and uses participant-clustered robust standard errors.
4. A minimal R logistic regression compares four overall test summaries.
5. A score-only R logistic regression compares mean scores for the four
   question types.
6. The retained exploratory R model estimates separate effects for canonical
   Q1–Q8 features; it is likely too large for the current sample.

The final workflow uses question-level rows with participant random effects.
The legacy prediction models aggregate to one row per participant-paper test.

The companion Python descriptive workflow produces macro test-level and micro
question-level distributions.

## Installation

### Python

From the repository root in PowerShell:

```powershell
py -m venv scripts/analysis/.venv
scripts/analysis/.venv/Scripts/Activate.ps1
python -m pip install -r scripts/analysis/requirements.txt
```

### R

Install R, then run:

```powershell
Rscript scripts/analysis/install_r_dependencies.R
```

This installs `data.table`, `dplyr`, `tidyr`, `lme4`, `broom.mixed`,
`glmmTMB`, `emmeans`, `ggplot2`, `jsonlite`, `detectseparation`, `knitr`,
`sandwich`, and `lmtest` when they are missing.

## Input

All authorship scripts read the same private comma- or tab-delimited file.
Required columns are:

`participant_id`, `paper_order`, `paper_position`, `field_type`, `position`,
`question_target`, `duration_ms`, `score`, `skipped`, `timed_out`, and
`response`.

The Python aggregate model additionally uses `attempt_score` and
`grader_feedback`.

Expected categorical values are normalized without regard to case. The
analysis accepts `out_field` and `out_of_field`, and it maps
`Background knowledgde`, `Background knowlegde`, and `Background knowledge`
to `Background knowledge`.

The scripts never modify the source file. Output tables can retain
pseudonymous `participant_id`, so use an appropriately protected output
location.

## Final primary analysis: ordered-beta performance models

Run:

```powershell
Rscript scripts/analysis/analyze_final_ordbeta.R C:\path\to\private-data.csv C:\path\to\final-output
```

The default output directory is `final_ordbeta_output`. The script requires
the common input columns listed above plus `question_type`, `attempt_score`,
and `duration_ms` for validation. It does not use `attempt_score` as a
predictor.

Skipped and timed-out questions receive score zero. Other missing scores
remain missing. Scores are divided by 100 and modeled on the closed interval
from zero to one with `glmmTMB::ordbeta()`.

The participant's counterbalanced order is read from the position-1 test.
That value determines the position-2 paper type by inversion. Values stored
on position-2 rows are not required to repeat the position-1 order label.
`paper_order` is not included as a model covariate.

H1 fits `paper_type * question_target` and attempts these participant
random-effects structures in order:

1. correlated random intercept and paper-type slope;
2. uncorrelated random intercept and paper-type slope;
3. random intercept only.

The first stable structure is retained. `model_attempts.csv` records all
attempts and simplifications. Four planned own-minus-foreign contrasts are
Holm-corrected together. Response-scale marginal means and confidence
intervals are also reported on the 0–100 score scale.

H2 uses only foreign-paper questions and models `field_type`, controlling for
question target with a participant random intercept.
Participant-level Welch and Wilcoxon tests provide robustness checks. A
nonsignificant result means that no field effect was detected; it does not
establish equivalence.

Sensitivity analyses repeat H1 and H2 after excluding skipped/timed-out
questions and separately model known nonresponse with a binomial mixed model
when feasible. Outputs include cleaned and participant-level data, validation
reports, descriptive summaries, PNG plots, model summaries and diagnostics,
estimated marginal means and contrasts, robustness tests,
`analysis_summary.json`, and Overleaf-ready tables under `latex/`.
The LaTeX output includes separate answered-only H1 marginal-mean and
Holm-adjusted contrast tables for appendix use.

### H1 and H2 descriptive plots

After running the final ordered-beta analysis, generate the hypothesis-focused
plots with:

```powershell
python scripts/analysis/plot_hypothesis_descriptives.py --analysis-dir final_ordbeta_output --output-dir hypothesis_plot_outputs
```

The separate output root contains:

- `png/h1_score_distribution.png`: own versus foreign score distributions,
  collapsing in-field and out-field foreign papers and displaying each
  category's Holm-adjusted H1 p-value;
- `png/h2_field_score_distribution.png`: foreign-paper in-field versus
  out-of-field score distributions by category, displaying the single overall
  H2 field-effect p-value;
- `png/h1_answered_only_score_distribution.png`: appendix sensitivity plot
  comparing own and foreign scores after excluding skipped and timed-out
  questions, with the answered-only Holm-adjusted H1 p-values;
- matching native TikZ/PGFPlots files under `latex/`;
- `plot_descriptions.csv`, containing accessible descriptions also embedded
  in PNG metadata and emitted through `\Description{}` in each LaTeX plot;
- `plotted_summary.csv`, containing question-row and participant sample sizes
  and the descriptive statistics used in the plots.

Displayed `n` values count nonmissing question rows; participant counts are
available in `plotted_summary.csv`. The plots use the primary
`score_analysis` outcome, so skipped and timed-out questions remain
zero-scored. The native `h2_field_score_distribution.tex` uses the compact
manuscript layout: a custom `\fieldBox` macro, line-broken category labels,
0.98-linewidth by 0.48-linewidth axes, compact whiskers and means, explicit
outlier points, and a three-item legend with per-box sample sizes. Its supplied
layout omits the overall H2 p-value from the figure itself; that model result
remains available in the analysis tables and PNG.

### Participant condition scores and ROC

Create an overlaid participant score plot and ROC curve directly from the
repeated test-level `attempt_score` in the raw data:

```powershell
python scripts/analysis/plot_participant_attempt_scores.py research-captcha-answers-2026-09-10.csv --output-dir participant_attempt_score_plots
```

The dated ResearchCAPTCHA export schema is accepted directly: `condition` and
`block_position` are normalized to the analysis names `paper_order` and
`paper_position`. The input argument defaults to
`research-captcha-answers-2026-09-10.csv`. The script uses condition directly:
`own` is familiar and `foreign` is unfamiliar. It validates
that each participant has exactly one eight-row test for each condition and
that `attempt_score` is identical across all eight rows of each test.
Standalone attempts with blank `participant_id` are excluded, as are rows
marked as warm-up questions.

The compact left panel uses separate Own and Unfamiliar x-axis columns with
sample sizes in the tick labels. Blue circles and orange squares receive small
horizontal jitter; open diamonds and colored segments show means and medians.
The compact right panel shows the ROC curve and AUC. Native LaTeX uses
`scale only axis`, 0.35-linewidth plotting rectangles, and a 0.16-linewidth
gap, matching the manuscript layout.

The right panel treats `foreign` as the positive class and uses
`1 - attempt_score/100` as an unfamiliarity score, so larger decision scores
indicate the positive class. It is titled
`ROC: Predicting Unfamiliar Label with (1-score)` and plots the empirical ROC
curve against the chance diagonal. The AUC is displayed in the panel and exported to
`roc_auc.csv`; `roc_curve.csv` contains the plotted false-positive and
true-positive rates. AUC is the probability that a randomly selected foreign
test has a higher unfamiliarity score than a randomly selected own-paper test,
with ties receiving half credit. It is descriptive and does not account for
uncertainty from the paired participant design.

The output root contains the PNG and native TikZ/PGFPlots figure,
pseudonymized plotted data, condition summaries, ROC/AUC CSVs, accessibility
text, and metadata. The LaTeX version requires `tikz`, `pgfplots`, the
PGFPlots `groupplots` library, and the TikZ `calc` library.

### Participant scores by question type

Create the same overlaid familiar-versus-unfamiliar score and ROC layout
separately for each question category:

```powershell
python scripts/analysis/plot_participant_question_type_scores.py research-captcha-answers-2026-09-10.csv --output-dir participant_question_type_score_plots
```

For each participant, condition, and category, the plotted score is the
arithmetic mean of its two questions. Skipped and timed-out questions
contribute zero. The script validates the eight-row test structure and the
two-questions-per-category design before writing five separate PNG and native
TikZ/PGFPlots figures: one per category and one pooled figure excluding
Planted error. The new export columns `condition`, `block_position`, and
`block_name` are normalized automatically; prefixed block labels such as
`F1 planted error` are recognized. Each compact left panel uses separate Own
and Unfamiliar columns with sample sizes in the tick labels, while the right
panel shows the corresponding ROC and AUC. Standalone attempts with blank
`participant_id` and warm-up rows are excluded before structural validation.

Each right panel treats unfamiliar/foreign as positive and uses
`1 - score_analysis/100` to plot its category-specific ROC curve and AUC. The
combined ROC coordinates are exported to `roc_curves.csv`, and the four AUC
values are exported to `roc_auc.csv`. That file also includes an
`Overall excluding Planted error` row. For this analysis, each
participant-condition score is the arithmetic mean of the six
`score_analysis` values from Unstated rationale, Background knowledge, and
Failure mode; skipped and timed-out questions remain zero. Its unfamiliarity
score is `1 - mean_non_planted_score/100`, and its ROC coordinates are included
in `roc_curves.csv`. Its write-up-ready PNG is
`png/overall_excluding_planted_error_score_scatterplots.png`, with a matching
native LaTeX file under `latex/`. The plotted participant-level values are
exported to `participant_non_planted_scores.csv`. The output root also includes
pseudonymized plotted data, condition summaries, accessible descriptions, and
metadata.

### Authorship-evaluation prompt export

Export each participant-paper test as one eight-question text prompt:

```powershell
python scripts/analysis/generate_authorship_prompts.py C:\path\to\full_data_answers.csv C:\path\to\research-captcha.db
```

The default `authorship_evaluation_prompts` folder contains
`PARTICIPANTID_1.txt` and `PARTICIPANTID_2.txt`. With the default validation
setting, the CSV must contain 30 participants. The script writes one file for
each test whose eight question texts are available in the database and prints a
warning listing tests it skips. Questions are ordered by their randomized
`position`. Empty responses are represented as `[No answer provided]`. Every
prompt includes the holistic authorship rubric, including its positive
signals, red flags, lenient treatment of late blanks, probability anchors, and
alternative-hypothesis sanity check.

Question text is loaded from `question_sets.questions_json` in the
ResearchCAPTCHA SQLite database. When the CSV contains `question_set_id` and
`question_id`, those identifiers are used directly. For older exports without
question identifiers, the script resolves each item through the participant's
experiment attempt, condition, randomized position, and
`attempts.question_order_json`. Existing prompt files are protected unless
`--overwrite` is supplied. The generated `prompt_manifest.csv` maps each
position-numbered prompt to its condition without putting that known condition
inside the prompt.

### OpenRouter authorship evaluation

Arrange the PDFs under a paper root:

```text
papers/
  ABCD/
    ABCD-own.pdf
    ABCD-unfamiliar.pdf
  EFGH/
    EFGH-own.pdf
    EFGH-unfamiliar.pdf
```

Set `OPENROUTER_API_KEY` in the environment, repository `.env.local`, or
repository `.env`. Then evaluate every generated prompt:

```powershell
python scripts/analysis/evaluate_authorship_prompts.py C:\path\to\authorship_evaluation_prompts C:\path\to\papers
```

Test a participant subset before running the full batch:

```powershell
python scripts/analysis/evaluate_authorship_prompts.py C:\path\to\authorship_evaluation_prompts C:\path\to\papers --participant-ids ABCD EFGH
```

The default is `openai/gpt-5.6-sol` with medium reasoning and OpenRouter's
native PDF parser. Override these with `--model`, `--reasoning-effort`, or
`--pdf-engine`. The PDF is uploaded with the neutral name `paper.pdf`, so its
own/unfamiliar filename does not disclose the known class to the model.

Results are written under `authorship_evaluation_results`: one JSON file per
successful prompt in `responses/`, `authorship_evaluation_summary.csv`, and
`authorship_evaluation_failures.csv`. A rerun skips a successful response when
its model, reasoning effort, prompt hash, and PDF hash still match; use
`--overwrite` to force reevaluation. Transient failures are retried, while
authentication failures stop the batch.

The evaluator imposes no local PDF-size limit. OpenRouter, its PDF parser, or
the selected model may still reject a file because of their own request,
document, or context limits; such a rejection is recorded as a per-test
failure.

Plot the resulting own-versus-foreign authorship-probability distributions:

```powershell
python scripts/analysis/plot_authorship_evaluation_distribution.py C:\path\to\authorship_evaluation_results\authorship_evaluation_summary.csv
```

The default `authorship_evaluation_distribution` folder contains a PNG, a
native TikZ/PGFPlots version under `latex/`, a condition-level descriptive
summary CSV, and an accessible plot description. The figure displays one
jittered point per evaluated test, Tukey boxplots, mean diamonds, medians, and
the available test count for each condition. Participants missing one
evaluation remain in the available condition rather than being discarded.

## Model 1: held-out prediction in Python

Run:

```powershell
python scripts/analysis/analyze_tests.py C:\path\to\private-data.csv --output-dir C:\path\to\cv-output
```

The default is five folds with random seed 2026. Use `--folds` and
`--random-state` to change them.

The preprocessor creates one row per `(participant_id, paper_position)` and
retains the existing 24 aggregate predictors:

- attempt score;
- answered-question mean duration for each target;
- skipped-question mean duration for each target;
- answered-question mean score for each target;
- total timed-out count;
- skipped-or-timed-out count for each target;
- response and grader-feedback mean lengths for the three free-response
  targets.

Filtered means with no observations are defined as zero in this aggregate
model. Predictors are standardized using training-fold data only.
`StratifiedGroupKFold` keeps both tests from each participant in the same
fold. Own paper is the positive class (1); foreign paper is the negative
class (0).

Python outputs:

- `test_features.csv`
- `authorship_cv_predictions.csv`
- `authorship_cv_metrics.csv`
- `analysis_summary.json`
- `latex/cv_performance.tex`

The pooled out-of-fold ROC AUC, Brier score, log loss, accuracy, and balanced
accuracy are the headline generalization results.

## Model 2: pooled feature associations in R (recommended)

Run:

```powershell
Rscript scripts/analysis/analyze_pooled_mixed_effects.R C:\path\to\private-data.csv C:\path\to\pooled-model-output
```

The output directory defaults to `pooled_mixed_effects_output`, separately
from the larger model.

The pooled script retains all structural and test-layout validation but
creates 10 numeric predictors for each participant-paper test:

- `timeout_count`: total number of timed-out questions among all eight;
- `total_skipped_count`: total number of skipped questions among all eight;
- four question-type-specific mean durations among completed questions only;
- four question-type-specific mean scores among completed questions only.

A question is completed only when both `skipped` and `timed_out` are false.
If neither question of a type was completed, that type's mean duration and
mean score are set to zero. No other missing value is replaced by zero.
Nonzero timed-out durations are valid but excluded from completed-question
means.

The generated formula has 12 nominal fixed-effect coefficients:

```r
Authorship ~
  field +
  timeout_count +
  total_skipped_count +
  planted_error_mean_duration +
  unstated_rationale_mean_duration +
  background_knowledge_mean_duration +
  failure_mode_mean_duration +
  planted_error_mean_score +
  unstated_rationale_mean_score +
  background_knowledge_mean_score +
  failure_mode_mean_score
```

The raw output retains durations in milliseconds and scores on their source
scale. Before fitting, all 10 numeric predictors are standardized over the
full inferential sample. Each coefficient is therefore an adjusted log-odds
change for a one-standard-deviation predictor increase, making magnitudes more
comparable. `scaling_parameters.csv` records every mean and standard
deviation.

The logistic coefficients are estimated with `glm(..., family = binomial())`.
Their covariance matrix uses participant-clustered HC1 sandwich estimation
with a finite-cluster adjustment, and coefficient tests use
`number_of_participants - 1` degrees of freedom. Thus the two rows from each
participant are not treated as independent when calculating standard errors,
confidence intervals, or p-values.

Pooled-model outputs include:

- `pooled_test_level_data.csv`
- `scaling_parameters.csv`
- `feature_dictionary.csv`
- `canonical_question_mapping.csv`
- `observed_question_mapping.csv`
- validation and invalid-row/test CSVs;
- missingness, variance, matrix-rank, alias, class-count, and convergence
  diagnostic CSVs;
- `model_formula.txt`, `model_summary.txt`, and `fixed_effects.csv`;
- `analysis_summary.json`;
- `latex/*.tex`.

The separation screen, rank check, GLM convergence diagnostics, cluster count,
and finite coefficient/covariance checks are retained. The script does not
fit the logistic model if the reduced design is rank-deficient or separated.

## Model 3: four-feature logistic regression

Run:

```powershell
Rscript scripts/analysis/analyze_four_feature_logistic.R C:\path\to\private-data.csv C:\path\to\four-feature-output
```

The default output directory is `four_feature_logistic_output`. This model
uses exactly four test-level predictors:

- mean score over completed questions;
- mean duration over completed questions;
- total number skipped;
- total number timed out.

Completed means neither skipped nor timed out. If a test has no completed
questions, both completed-question means are set to zero. All four predictors
are standardized and recorded in `scaling_parameters.csv`.

The script fits an ordinary binomial logistic regression and calculates HC1
participant-clustered robust standard errors with a finite-cluster adjustment.
It reports robust coefficients, odds ratios, confidence intervals, p-values,
and in-sample deviance, AIC, pseudo-R-squared, ROC AUC, Brier score, and
accuracy. These fit metrics are descriptive and are not held-out estimates.

Outputs include `four_feature_test_level_data.csv`, `fixed_effects.csv`,
`in_sample_fit_metrics.csv`, validation/diagnostic files,
`analysis_summary.json`, and Overleaf-ready files under `latex/`.

## Model 4: question-type mean-score logistic regression

Run:

```powershell
Rscript scripts/analysis/analyze_type_score_logistic.R C:\path\to\private-data.csv C:\path\to\type-score-output
```

The default output directory is `type_score_logistic_output`. The model has
four predictors: mean score for planted-error, unstated-rationale,
background-knowledge, and failure-mode questions. Within each question type,
a skipped question contributes a score of zero. Timed-out questions are
removed from both the numerator and denominator. If both questions of a type
timed out, that type's mean is set to zero.

The four predictors are standardized before fitting an ordinary binomial
logistic regression. Inference uses HC1 participant-clustered robust standard
errors with a finite-cluster adjustment. Fit metrics are in-sample, not
held-out estimates.

Outputs include `type_score_test_level_data.csv`, `scaling_parameters.csv`,
`fixed_effects.csv`, `in_sample_fit_metrics.csv`, validation/diagnostic files,
`analysis_summary.json`, and Overleaf-ready files under `latex/`.

## Model 5: Q1–Q8 feature associations in R (exploratory)

Run:

```powershell
Rscript scripts/analysis/analyze_mixed_effects.R C:\path\to\private-data.csv C:\path\to\mixed-model-output
```

The output directory defaults to `mixed_effects_output`. This larger
specification is retained for reproducibility, but the pooled model above is
recommended for the current sample.

### Canonical question mapping

Each test must have exactly two questions of each required type and eight
questions total. Questions are sorted by this fixed type order and then by
their original randomized test position:

- Q1–Q2: Planted error
- Q3–Q4: Unstated rationale
- Q5–Q6: Background knowledge
- Q7–Q8: Failure mode

The script writes both the fixed canonical mapping and a per-test audit table
that links canonical labels to original positions.

`paper_id` is the participant-relative `paper_position`. Authorship is derived
from the participant's position-1 `paper_order`; position 2 is assigned the
opposite type. `Authorship = 1` means own paper and `Authorship = 0` means
foreign paper.

`field` is the participant's foreign-paper stratum, copied onto both of that
participant's test rows. `in_field` is the reference level. This represents
the experimental field condition without making `out_field` deterministically
identify a foreign paper.

### Question features and structural checks

Every Q1–Q8 block contains:

- `status`
- `skipped`
- `score`
- `duration`

Q3–Q8 also contain `answer_length`, measured in characters. Q1–Q2 are
multiple choice and have no answer-length predictor.

Status levels are `completed` (reference), `skipped`, and `timed_out`.
Skipped and timed out must be mutually exclusive. Before reshaping, the script
requires:

- exactly two tests per participant;
- exactly one row per participant-paper test after reshaping;
- exactly eight questions and original positions 1–8 per test;
- exactly two questions of each required type;
- one position-1 paper order and one field stratum per participant;
- score zero for skipped and timed-out questions;
- answer length zero for skipped and timed-out free responses.

Only status-defined structural answer-length zeros are assigned zero.
Unrelated missing values remain missing. Structural or test-layout violations
are hard failures: validation files are written and the model is not fit.
Column names must remain unique after lowercase/whitespace normalization;
unrelated extra export columns are accepted and ignored.

Timed-out questions may have nonzero duration when time elapsed before the
system timeout. The model retains those values. Its base question-duration
slope is shared by completed and timed-out questions, while the
skipped-by-duration interaction provides a separate slope for skipped
questions.

### Mixed-effects formula

The script builds and saves the formula programmatically. It includes:

```r
Authorship ~
  (1 | participant_id) +
  field +
  # Q1-Q2:
  question_status + question_score + question_duration +
  question_skipped:question_duration +
  # Q3-Q8 additionally:
  question_answer_length
```

The Q-specific terms are expanded separately for Q1 through Q8. The exact
formula is written to `model_formula.txt`.

The model is fit with:

```r
lme4::glmer(
  formula = model_formula,
  data = model_data,
  family = binomial()
)
```

Continuous predictors remain in source units. The script does not
automatically scale, pool, regularize, remove terms, change optimizers, or
retry a simpler model.

Status coefficients compare skipped and timed-out questions with completed
questions. Score and answer-length effects are informed by completed
questions because the other statuses have structural zeros. The duration
slope for completed and timed-out questions is `beta_duration`; the
skipped-question slope is
`beta_duration + beta_skipped:duration`.

### Diagnostics and dimensionality

Before fitting, the R workflow reports variable missingness, complete-case
exclusions, raw and model-matrix zero/near-zero variance, model-matrix rank,
sample/class counts, and the nominal fixed-effect count. It also screens the
equivalent fixed-effects-only binomial design for separation; that screen does
not incorporate the participant random effect.

If complete-case filtering breaks a participant pair, the affected participant
is listed and counted. A rank-deficient fixed-effect design or detected
fixed-effects separation blocks fitting, because allowing `glmer()` to drop
columns would silently change the requested formula.

The fully expanded formula has 48 fixed-effect coefficients including the
intercept. With 25 participants and 50 tests, this model is nearly saturated
and may be rank-deficient, separated, singular, or unable to converge. This
is reported explicitly. The script does not silently simplify the model.

After fitting, it captures:

- the complete model summary;
- rank-deficiency and dropped-column messages;
- optimizer and convergence diagnostics;
- singular-fit status and random-intercept variance;
- finite coefficient/covariance checks;
- observations used and tests excluded for missingness;
- complete/quasi-complete separation evidence.

### R output files

- `test_level_data.csv`
- `canonical_question_mapping.csv`
- `observed_question_mapping.csv`
- `validation_report.csv`
- `invalid_rows.csv`
- `invalid_tests.csv`
- `model_missingness.csv`
- `excluded_model_tests.csv`
- `complete_case_participant_checks.csv`
- `predictor_variance.csv`
- `model_matrix_diagnostics.csv`
- `aliased_terms.csv`
- `authorship_class_counts.csv`
- `model_formula.txt`
- `model_summary.txt`
- `fixed_effects.csv`
- `model_diagnostics.csv`
- `analysis_summary.json`
- `latex/*.tex`

Model failures produce explicit status and diagnostic artifacts instead of
empty tables that appear valid.

For Overleaf, upload the generated `latex` directory and use:

```latex
\usepackage{booktabs}
\usepackage{longtable}
\input{latex/all_tables.tex}
```

The generated fragments summarize the canonical mapping, sample/class counts,
fixed effects, and model diagnostics.

## Convert current answer exports

Convert the current ResearchCAPTCHA export schema to the legacy
`full_data_answers.csv` schema used by older analysis scripts:

```powershell
python scripts/analysis/convert_answer_export.py research-captcha-answers-2026-09-10.csv --output full_data_answers.csv
```

Both paths have those defaults and may be omitted. Add `--overwrite` to replace
an existing output. The converter maps `condition` to `paper_order`,
`block_position` to `paper_position`, and `foreign_stratum` to `field_type`;
`out_of_field` is normalized to `out_field`. Canonical `question_target` values
are derived from `block_name`, including prefixed labels such as
`F1 planted error`. Standalone rows with blank participant IDs and warm-up rows
are excluded. The output uses exactly the requested 21-column order and
requires eight retained rows per participant-paper test.

## Descriptive distributions

Run:

```powershell
python scripts/analysis/descriptive_statistics.py C:\path\to\private-data.csv --output-dir C:\path\to\descriptive-output
```

The workflow compares own, in-field unfamiliar, and out-field unfamiliar
tests. `macro_averaged` outputs treat each eligible test equally;
`micro_averaged` outputs pool question rows. It produces CSV summaries, PNG
previews, and native TikZ/PGFPlots fragments for score, answered duration,
response length, skipped duration, skipped prevalence, and first timeout
position. Distribution figures use Tukey box-and-whisker plots (quartiles,
median, 1.5-IQR whiskers, outliers, and a diamond mean marker); skipped
prevalence remains a grouped bar chart. The three paper settings use both an
Okabe--Ito colorblind-accessible palette and distinct diagonal/crosshatch
patterns. Sample-size labels occupy a separate row above the axes rather than
overlapping boxes, whiskers, bars, or observed points. Legends show each
setting as a rectangular color-and-pattern swatch. The score figure uses the
short title `Score distribution`.

Skipped prevalence is plotted as
`100 * n_skipped / n_total`, with `n_total` shown on each bar. Its y-axis is
rounded up to the nearest five percentage points above the tallest bar, with
additional padding rather than always extending to 100%. Sample-size labels
remain in the dedicated row above the axes.

Add this package for the descriptive TikZ files:

```latex
\usepackage{pgfplots}
\usetikzlibrary{patterns}
\pgfplotsset{compat=1.18}
```

## Scores by seniority and paper year

Run:

```powershell
python scripts/analysis/demographic_score_statistics.py C:\path\to\answer-data.csv C:\path\to\participants.csv C:\path\to\metadata.csv --output-dir C:\path\to\demographic-score-output
```

The answer-level file supplies question scores, the participants file supplies
`participant_id` and `own_paper_date`, and the metadata file supplies the
participant ID and `job_title`. IDs are matched case-insensitively across all
three files. Both own- and unfamiliar-paper tests are included but displayed
in separate familiar (own) and unfamiliar (foreign) panels. Skipped and
timed-out questions are assigned score zero, then scores are averaged within
participant, paper familiarity, and question type so each participant
contributes at most one observation to each displayed bar.

Paper familiarity is derived from each participant's position-1
`paper_order`, then applied consistently to both paper positions. The script
does not reinterpret the position-2 row's `paper_order` as a second ordering
assignment. Before aggregation, it requires each participant to have exactly
one familiar and one unfamiliar test, each with eight positions and exactly
two questions of every target type. Violations stop the analysis with the
affected participant/test IDs, ensuring equivalent left- and right-panel bars
use the same participant cohort.

Job titles are normalized into four ordered seniority bins: Master’s, PhD,
Postdoc, and Professor. Unrecognized nonblank titles cause an actionable
error rather than being silently grouped. Own-paper publication dates are
grouped as 2023 or earlier, 2024, 2025, and 2026.

Outputs are:

- `score_by_seniority.png` and `.tex`;
- `score_by_paper_age.png` and `.tex`;
- `demographic_score_summary.csv`, containing participant counts, mean scores,
  and standard deviations for every displayed group.

The grouped bars use both color and texture, have dedicated sample-size labels
above the plotting area, use tightened score axes, and include generated
`\Description{...}` text in each TikZ fragment. The two-panel TikZ plots also
require:

```latex
\usepgfplotslibrary{groupplots}
```

## Qualitative codes by participant characteristics

Run:

```powershell
python scripts/analysis/qualitative_demographic_statistics.py C:\path\to\code_comparisons.csv C:\path\to\participants_combined.csv --output-dir C:\path\to\qualitative-demographic-output
```

The first column of `code_comparisons.csv` supplies qualitative-code labels;
every remaining column must be an interview filename such as
`2BHV.clean.txt`. These filenames are matched, after trimming surrounding
whitespace, to `participants_combined.file_name`. The corresponding
participant columns supply three independent comparisons:

- `job_title`: Junior (Master’s and PhD) versus Senior (Postdoc and
  Professor);
- `own_paper_date`: 2026 versus any year before 2026;
- `own_score`: below the observed median versus at or above the median.

The script rejects unmatched or duplicate interview filenames, blank or
duplicate code labels, blank annotation-count cells, negative/non-integer
counts, unrecognized job titles, invalid nonblank dates/scores, and any
comparison lacking one of its two groups. Blank paper dates or own scores are
excluded only from their respective comparison. Participants tied at the
own-score median are assigned to the top group.

For each code, the script calculates mean annotations per participant in both
groups, computes first-group minus second-group and its absolute value, and
ranks codes by the absolute difference. Each comparison receives its own
independently selected top 10; code name breaks exact ties deterministically.
It writes:

- `top_codes_by_seniority.png` and `.tex`;
- `top_codes_by_paper_year.png` and `.tex`;
- `top_codes_by_own_score.png` and `.tex`;
- `code_seniority_summary.csv`, `code_paper_year_summary.csv`, and
  `code_own_score_summary.csv`.

Every plot is a direct PGFPlots/PNG grouped bar chart with colorblind colors,
distinct textures, labeled means, group sample sizes, and a generated
`\Description{...}`. Each summary contains both group means/sample sizes,
signed and absolute differences, and ranks for all codes. The own-score
summary also records the median cutoff. Qualitative TikZ fragments
temporarily disable TikZ externalization while rendering and restore it
afterward, avoiding nested externalizer failures when they are included from a
document that globally enables `\tikzexternalize`.

The TikZ fragment requires:

```latex
\usepackage{pgfplots}
\usetikzlibrary{patterns}
\pgfplotsset{compat=1.18}
```

## Accessible LaTeX descriptions

Every generated plot `.tex` file from `descriptive_statistics.py` and
`demographic_statistics.py` includes a `\Description{...}` command. The
descriptive plots explain the encodings, comparison groups, observation unit,
and observed range. The demographic descriptions also enumerate the generated
bin or category counts. The ACM `acmart` document class used for CHI defines
`\Description`; regenerate the `.tex` outputs after changing data so these
data-aware descriptions remain current.

## Participant demographic figures

Run the separate participant-level export through:

```powershell
python scripts/analysis/demographic_statistics.py C:\path\to\participant-data.csv C:\path\to\recruitment-data.csv --output-dir C:\path\to\demographic-output
```

Blank values are excluded independently for each variable. Preparation time
is interpreted as numeric minutes and shown in a five-bin histogram.
Published-paper counts are grouped into `0--4`, `5--9`, `10--19`, `20--49`,
and `50+`; these left-inclusive ranges correspond to boundaries 0, 5, 10, 20,
and 50. Job-title categories are retained as supplied after trimming
whitespace. The second CSV supplies `arXiv Field Taxonomy`; the five most
frequent nonblank values are shown individually and all remaining values are
combined as `Other`.

Before calculating any demographic summaries, `participant_id` from the first
CSV is matched case-insensitively to
`Participant ID (links experimental data to participant)` in the second CSV.
Participants absent from the second file are excluded from every panel, and
their IDs are printed in a warning. Duplicate participant IDs in the first
file are rejected; duplicate metadata rows use the first row with a warning.
The arXiv panel is restricted to the same matched participants.

The output directory contains:

- `preparation_time_histogram.png` and `.tex`: the standalone appendix figure;
- `participant_characteristics.png` and `.tex`: published-paper, job-title,
  and arXiv-field vertical bar charts side-by-side;
- `demographic_summary.csv`: aggregate histogram and category counts.

The PNG figures show sample sizes in their titles.
`participant_characteristics.tex` is a compact TikZ fragment intended for a
surrounding manuscript figure environment. It uses three manually positioned
`scale only axis` panels, rotated x-axis category labels, data labels above the
bars, constrained panel titles, and a shared vertical Participants label.
Panel widths are calculated from `\linewidth`, matching the manuscript layout.
Both formats use colorblind-accessible colors and distinct textures. The TikZ
files are generated directly, embed their data, and temporarily disable global
TikZ externalization. They require:

```latex
\usepackage{pgfplots}
\usetikzlibrary{patterns}
\pgfplotsset{compat=1.18}
```
