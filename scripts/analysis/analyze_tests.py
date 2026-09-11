"""Aggregate question rows and cross-validate paper-authorship prediction.

This Python workflow is intentionally limited to held-out prediction. The
question-specific mixed-effects feature analysis is implemented in
``analyze_mixed_effects.R``.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    log_loss,
    mean_squared_error,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


LOGGER = logging.getLogger("paper_authorship_prediction")

TARGET_LABELS = {
    "planted_error": "Planted error",
    "unstated_rationale": "Unstated rationale",
    "background_knowledge": "Background knowledge",
    "failure_mode": "Failure mode",
}
FREE_RESPONSE_TARGETS = (
    "unstated_rationale",
    "background_knowledge",
    "failure_mode",
)
TARGET_ALIASES = {
    "planted error": "planted_error",
    "unstated rationale": "unstated_rationale",
    "background knowledge": "background_knowledge",
    "background knowlegde": "background_knowledge",
    "background knowledgde": "background_knowledge",
    "failure mode": "failure_mode",
}
REQUIRED_COLUMNS = {
    "participant_id",
    "paper_order",
    "paper_position",
    "field_type",
    "attempt_score",
    "position",
    "question_target",
    "duration_ms",
    "score",
    "skipped",
    "timed_out",
    "response",
    "grader_feedback",
}


def feature_columns() -> list[str]:
    """Return the 24 aggregate predictors in stable order."""
    columns = ["attempt_score"]
    columns.extend(f"duration_answered_{target}_mean_ms" for target in TARGET_LABELS)
    columns.extend(f"duration_skipped_{target}_mean_ms" for target in TARGET_LABELS)
    columns.extend(f"score_answered_{target}_mean" for target in TARGET_LABELS)
    columns.append("timed_out_count")
    columns.extend(f"skipped_or_timed_out_{target}_count" for target in TARGET_LABELS)
    for target in FREE_RESPONSE_TARGETS:
        columns.extend(
            (
                f"response_length_{target}_mean",
                f"grader_feedback_length_{target}_mean",
            )
        )
    assert len(columns) == 24
    return columns


FEATURE_COLUMNS = feature_columns()


def _normalized_text(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.lower().str.replace(r"\s+", " ", regex=True)


def _parse_boolean(series: pd.Series, column: str) -> pd.Series:
    parsed = _normalized_text(series).map(
        {
            "true": True,
            "false": False,
            "1": True,
            "0": False,
            "yes": True,
            "no": False,
        }
    )
    if parsed.isna().any():
        examples = sorted(_normalized_text(series)[parsed.isna()].unique().tolist())[:5]
        raise ValueError(f"Column '{column}' has invalid boolean values: {examples}")
    return parsed.astype(bool)


def _parse_numeric(series: pd.Series, column: str) -> pd.Series:
    parsed = pd.to_numeric(series.astype(str).str.strip(), errors="coerce")
    if parsed.isna().any():
        rows = (parsed[parsed.isna()].index + 2).tolist()[:8]
        raise ValueError(
            f"Column '{column}' has missing or non-numeric values at input rows {rows}. "
            "No imputation is performed."
        )
    return parsed


def _parse_integer(series: pd.Series, column: str) -> pd.Series:
    parsed = _parse_numeric(series, column)
    non_integer = ~np.isclose(parsed, np.round(parsed))
    if non_integer.any():
        values = sorted(parsed[non_integer].unique().tolist())[:5]
        raise ValueError(f"Column '{column}' must contain integers; found {values}.")
    return parsed.astype(int)


def load_question_data(path: Path) -> pd.DataFrame:
    """Load comma- or tab-delimited question data and normalize values."""
    if not path.is_file():
        raise FileNotFoundError(f"Input file does not exist: {path}")
    try:
        data = pd.read_csv(
            path,
            sep=None,
            engine="python",
            dtype=str,
            keep_default_na=False,
            na_filter=False,
        )
    except Exception as exc:
        raise ValueError(f"Could not parse '{path}' as CSV or TSV: {exc}") from exc

    columns = [str(column).strip().lower() for column in data.columns]
    if len(columns) != len(set(columns)):
        raise ValueError("The input contains duplicate column names after normalization.")
    data.columns = columns
    missing = sorted(REQUIRED_COLUMNS - set(data.columns))
    if missing:
        raise ValueError(f"Input is missing required columns: {', '.join(missing)}")
    if data.empty:
        raise ValueError("Input contains no data rows.")

    data = data.copy()
    data["participant_id"] = data["participant_id"].astype(str).str.strip()
    if data["participant_id"].eq("").any():
        rows = (data["participant_id"].eq("")[lambda value: value].index + 2).tolist()[:8]
        raise ValueError(f"participant_id is blank at input rows {rows}.")

    data["paper_order"] = _normalized_text(data["paper_order"])
    if (~data["paper_order"].isin({"own", "foreign"})).any():
        values = sorted(
            data.loc[~data["paper_order"].isin({"own", "foreign"}), "paper_order"]
            .unique()
            .tolist()
        )
        raise ValueError(f"paper_order must be 'own' or 'foreign'; found {values}.")

    data["paper_position"] = _parse_integer(data["paper_position"], "paper_position")
    data["position"] = _parse_integer(data["position"], "position")
    data["attempt_score"] = _parse_numeric(data["attempt_score"], "attempt_score")
    data["duration_ms"] = _parse_numeric(data["duration_ms"], "duration_ms")
    data["score"] = _parse_numeric(data["score"], "score")
    data["skipped"] = _parse_boolean(data["skipped"], "skipped")
    data["timed_out"] = _parse_boolean(data["timed_out"], "timed_out")

    if (~data["paper_position"].isin({1, 2})).any():
        values = sorted(
            data.loc[~data["paper_position"].isin({1, 2}), "paper_position"]
            .unique()
            .tolist()
        )
        raise ValueError(f"paper_position must be 1 or 2; found {values}.")
    if (~data["position"].between(1, 8)).any():
        values = sorted(
            data.loc[~data["position"].between(1, 8), "position"].unique().tolist()
        )
        raise ValueError(f"position must be between 1 and 8; found {values}.")

    source_target = _normalized_text(data["question_target"])
    data["question_target"] = source_target.map(TARGET_ALIASES)
    if data["question_target"].isna().any():
        values = sorted(source_target[data["question_target"].isna()].unique().tolist())
        raise ValueError(f"Unrecognized question_target values: {values}.")

    field = _normalized_text(data["field_type"]).replace({"out_of_field": "out_field"})
    if (~field.isin({"in_field", "out_field"})).any():
        values = sorted(field[~field.isin({"in_field", "out_field"})].unique().tolist())
        raise ValueError(f"field_type must be 'in_field' or 'out_field'; found {values}.")
    data["field_type"] = field
    return data


def _one_consistent_value(group: pd.DataFrame, column: str, key: tuple[Any, ...]) -> Any:
    values = group[column].drop_duplicates()
    if len(values) != 1:
        raise ValueError(
            f"Test {key} has inconsistent '{column}' values: {values.astype(str).tolist()}."
        )
    return values.iloc[0]


def _filtered_mean(group: pd.DataFrame, column: str, mask: pd.Series) -> float:
    values = group.loc[mask, column]
    return float(values.mean()) if not values.empty else 0.0


def preprocess_tests(question_data: pd.DataFrame) -> pd.DataFrame:
    """Collapse eight question rows into one aggregate row per paper test."""
    first_paper_types: dict[str, str] = {}
    for participant_id, rows in question_data.groupby("participant_id", sort=True):
        first_orders = rows.loc[
            rows["paper_position"].eq(1), "paper_order"
        ].drop_duplicates()
        if len(first_orders) != 1:
            raise ValueError(
                f"Participant '{participant_id}' must have exactly one paper_order "
                "value among paper_position 1 rows."
            )
        first_paper_types[participant_id] = str(first_orders.iloc[0])

    records: list[dict[str, Any]] = []
    for key, group in question_data.groupby(
        ["participant_id", "paper_position"], sort=True
    ):
        participant_id, paper_position = key
        if len(group) != 8:
            raise ValueError(f"Test {key} has {len(group)} rows; exactly 8 are required.")
        positions = sorted(group["position"].tolist())
        if positions != list(range(1, 9)):
            raise ValueError(
                f"Test {key} must contain each position 1-8 exactly once; "
                f"found {positions}."
            )

        first_type = first_paper_types[participant_id]
        second_type = "foreign" if first_type == "own" else "own"
        paper_type = first_type if paper_position == 1 else second_type
        source_field = _one_consistent_value(group, "field_type", key)
        record: dict[str, Any] = {
            "participant_id": participant_id,
            "paper_position": int(paper_position),
            "paper_type": paper_type,
            "field_type": "in_field" if paper_type == "own" else source_field,
            "attempt_score": float(
                _one_consistent_value(group, "attempt_score", key)
            ),
        }

        answered = ~(group["timed_out"] | group["skipped"])
        for target in TARGET_LABELS:
            target_rows = group["question_target"].eq(target)
            record[f"duration_answered_{target}_mean_ms"] = _filtered_mean(
                group, "duration_ms", target_rows & answered
            )
            record[f"duration_skipped_{target}_mean_ms"] = _filtered_mean(
                group, "duration_ms", target_rows & group["skipped"]
            )
            record[f"score_answered_{target}_mean"] = _filtered_mean(
                group, "score", target_rows & answered
            )
            record[f"skipped_or_timed_out_{target}_count"] = int(
                (target_rows & (group["skipped"] | group["timed_out"])).sum()
            )

        record["timed_out_count"] = int(group["timed_out"].sum())
        for target in FREE_RESPONSE_TARGETS:
            rows = group.loc[group["question_target"].eq(target)]
            record[f"response_length_{target}_mean"] = (
                float(rows["response"].astype(str).str.len().mean())
                if not rows.empty
                else 0.0
            )
            record[f"grader_feedback_length_{target}_mean"] = (
                float(rows["grader_feedback"].astype(str).str.len().mean())
                if not rows.empty
                else 0.0
            )
        records.append(record)

    tests = pd.DataFrame.from_records(records)
    tests = tests[
        [
            "participant_id",
            "paper_position",
            "paper_type",
            "field_type",
            *FEATURE_COLUMNS,
        ]
    ].sort_values(["participant_id", "paper_position"], kind="stable")
    tests = tests.reset_index(drop=True)
    if tests[FEATURE_COLUMNS].isna().any().any():
        columns = tests[FEATURE_COLUMNS].columns[
            tests[FEATURE_COLUMNS].isna().any()
        ].tolist()
        raise ValueError(
            "Preprocessing produced missing model values: " + ", ".join(columns)
        )
    return tests


def complete_participant_pairs(tests: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Keep participants with exactly one own and one foreign test."""
    valid_ids: list[str] = []
    excluded_ids: list[str] = []
    for participant_id, group in tests.groupby("participant_id", sort=True):
        valid = (
            len(group) == 2
            and set(group["paper_position"]) == {1, 2}
            and group["paper_type"].value_counts().to_dict()
            == {"own": 1, "foreign": 1}
        )
        (valid_ids if valid else excluded_ids).append(participant_id)
    if excluded_ids:
        LOGGER.warning(
            "Excluding %d participants without exactly one own and one foreign test.",
            len(excluded_ids),
        )
    complete = tests[tests["participant_id"].isin(valid_ids)].copy()
    if complete.empty:
        raise ValueError("No complete participant pairs are available for modeling.")
    return complete, excluded_ids


def _active_features(data: pd.DataFrame) -> tuple[list[str], list[str]]:
    constant = [column for column in FEATURE_COLUMNS if data[column].nunique() <= 1]
    active = [column for column in FEATURE_COLUMNS if column not in constant]
    if constant:
        LOGGER.warning("Omitting constant predictors: %s", ", ".join(constant))
    if not active:
        raise ValueError("All model predictors are constant.")
    return active, constant


def _binary_metrics(y: np.ndarray, probability: np.ndarray) -> dict[str, float]:
    prediction = (probability >= 0.5).astype(int)
    return {
        "roc_auc": float(roc_auc_score(y, probability)),
        "brier_score": float(np.mean(np.square(probability - y))),
        "log_loss": float(log_loss(y, np.clip(probability, 1e-15, 1 - 1e-15))),
        "accuracy": float(accuracy_score(y, prediction)),
        "balanced_accuracy": float(balanced_accuracy_score(y, prediction)),
        "rmse": float(np.sqrt(mean_squared_error(y, probability))),
    }


def run_logistic_cross_validation(
    data: pd.DataFrame, requested_folds: int, random_state: int
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Generate one participant-grouped out-of-fold prediction per test."""
    active, constant = _active_features(data)
    y = data["paper_type"].eq("own").astype(int).to_numpy()
    groups = data["participant_id"].to_numpy()
    folds = min(requested_folds, data["participant_id"].nunique())
    if folds < 2:
        raise ValueError("At least two complete participants are required.")

    splitter = StratifiedGroupKFold(
        n_splits=folds, shuffle=True, random_state=random_state
    )
    probability = np.full(len(data), np.nan)
    fold_number = np.zeros(len(data), dtype=int)
    fold_rows: list[dict[str, Any]] = []
    for fold, (train_index, test_index) in enumerate(
        splitter.split(data[active], y, groups), start=1
    ):
        if len(np.unique(y[train_index])) < 2 or len(np.unique(y[test_index])) < 2:
            raise ValueError(f"Fold {fold} lacks both outcome classes.")
        model = Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "logistic",
                    LogisticRegression(
                        solver="lbfgs",
                        max_iter=10_000,
                        random_state=random_state,
                    ),
                ),
            ]
        )
        model.fit(data.iloc[train_index][active], y[train_index])
        fold_probability = model.predict_proba(data.iloc[test_index][active])[:, 1]
        probability[test_index] = fold_probability
        fold_number[test_index] = fold
        fold_rows.append(
            {
                "scope": f"fold_{fold}",
                "fold": fold,
                "train_tests": int(len(train_index)),
                "test_tests": int(len(test_index)),
                "test_participants": int(
                    data.iloc[test_index]["participant_id"].nunique()
                ),
                **_binary_metrics(y[test_index], fold_probability),
            }
        )

    if np.isnan(probability).any():
        raise RuntimeError("Cross-validation did not predict every test.")
    pooled = _binary_metrics(y, probability)
    fold_rows.insert(
        0,
        {
            "scope": "pooled_out_of_fold",
            "fold": "",
            "train_tests": "",
            "test_tests": int(len(data)),
            "test_participants": int(data["participant_id"].nunique()),
            **pooled,
        },
    )
    predictions = data[
        ["participant_id", "paper_position", "paper_type", "field_type"]
    ].copy()
    predictions["observed_own"] = y
    predictions["predicted_probability_own"] = probability
    predictions["predicted_own"] = (probability >= 0.5).astype(int)
    predictions["fold"] = fold_number
    summary = {
        "folds": folds,
        "tests": int(len(data)),
        "participants": int(data["participant_id"].nunique()),
        "active_features": active,
        "constant_features": constant,
        "pooled_metrics": pooled,
    }
    return predictions, pd.DataFrame(fold_rows), summary


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return None if not np.isfinite(value) else float(value)
    if isinstance(value, float):
        return None if not np.isfinite(value) else value
    return value


def _format_number(value: Any, digits: int = 3) -> str:
    if value is None or value == "" or pd.isna(value):
        return "--"
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    return f"{float(value):.{digits}f}"


def write_cv_latex_table(output_dir: Path, cv_metrics: pd.DataFrame) -> None:
    """Write an Overleaf-ready held-out performance table."""
    latex_dir = output_dir / "latex"
    latex_dir.mkdir(parents=True, exist_ok=True)
    rows: list[str] = []
    for row in cv_metrics.to_dict("records"):
        scope = (
            "Pooled out-of-fold"
            if row["scope"] == "pooled_out_of_fold"
            else str(row["scope"]).replace("_", " ").title()
        )
        rows.append(
            " & ".join(
                [
                    scope,
                    _format_number(row["test_tests"], 0),
                    _format_number(row["roc_auc"]),
                    _format_number(row["brier_score"]),
                    _format_number(row["log_loss"]),
                    _format_number(row["accuracy"]),
                    _format_number(row["balanced_accuracy"]),
                ]
            )
            + r" \\"
        )
    table = "\n".join(
        [
            r"\begin{table}[htbp]",
            r"\centering",
            r"\small",
            r"\caption{Held-out prediction of paper authorship}",
            r"\label{tab:authorship-cv}",
            r"\resizebox{\linewidth}{!}{%",
            r"\begin{tabular}{lrrrrrr}",
            r"\toprule",
            r"Evaluation & $N$ & AUC & Brier & Log loss & Accuracy & Bal. accuracy \\",
            r"\midrule",
            *rows,
            r"\bottomrule",
            r"\end{tabular}",
            r"}",
            r"\parbox{0.95\linewidth}{\footnotesize \textit{Note.} Both tests from "
            r"each participant remain in the same cross-validation fold.}",
            r"\end{table}",
            "",
        ]
    )
    (latex_dir / "cv_performance.tex").write_text(table, encoding="utf-8")


def run_analysis(
    input_path: Path, output_dir: Path, folds: int, random_state: int
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    questions = load_question_data(input_path)
    tests = preprocess_tests(questions)
    tests.to_csv(output_dir / "test_features.csv", index=False)
    complete, excluded_ids = complete_participant_pairs(tests)
    predictions, metrics, cv_summary = run_logistic_cross_validation(
        complete, folds, random_state
    )
    predictions.to_csv(output_dir / "authorship_cv_predictions.csv", index=False)
    metrics.to_csv(output_dir / "authorship_cv_metrics.csv", index=False)
    write_cv_latex_table(output_dir, metrics)

    summary = {
        "input_rows": int(len(questions)),
        "aggregated_tests": int(len(tests)),
        "complete_pair_tests": int(len(complete)),
        "complete_participants": int(complete["participant_id"].nunique()),
        "excluded_incomplete_participant_count": int(len(excluded_ids)),
        "cross_validation": cv_summary,
    }
    (output_dir / "analysis_summary.json").write_text(
        json.dumps(_json_safe(summary), indent=2), encoding="utf-8"
    )
    return summary


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Cross-validate aggregate prediction of paper authorship."
    )
    parser.add_argument("input", type=Path, help="Private question-level CSV or TSV.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("analysis_output"),
        help="Directory for aggregate features and held-out results.",
    )
    parser.add_argument(
        "--folds",
        type=int,
        default=5,
        help="Maximum participant-grouped folds (default: 5).",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=2026,
        help="Cross-validation random seed (default: 2026).",
    )
    return parser


def main() -> None:
    parser = build_argument_parser()
    args = parser.parse_args()
    if args.folds < 2:
        parser.error("--folds must be at least 2.")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        summary = run_analysis(
            args.input.resolve(),
            args.output_dir.resolve(),
            args.folds,
            args.random_state,
        )
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
        return
    LOGGER.info(
        "Cross-validation complete: %d tests from %d participants. Results: %s",
        summary["complete_pair_tests"],
        summary["complete_participants"],
        args.output_dir.resolve(),
    )


if __name__ == "__main__":
    main()
