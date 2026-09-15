"""Plot participant scores by question target and paper familiarity.

Runtime packages: pandas, numpy, and matplotlib.
LaTeX outputs require tikz, pgfplots, the PGFPlots groupplots library, and the
TikZ calc library. The ACM ``acmart`` class supplies ``\\Description``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, roc_curve


REQUIRED_COLUMNS: tuple[str, ...] = (
    "participant_id",
    "paper_order",
    "paper_position",
    "question_target",
    "score",
    "skipped",
    "timed_out",
)
CONDITION_ORDER: tuple[str, ...] = ("own", "foreign")
CONDITION_LABELS: Mapping[str, str] = {
    "own": "Familiar (own paper)",
    "foreign": "Unfamiliar (foreign paper)",
}
CONDITION_COLORS: Mapping[str, str] = {
    "own": "#0072B2",
    "foreign": "#E69F00",
}
CONDITION_MARKERS: Mapping[str, str] = {
    "own": "o",
    "foreign": "s",
}
TIKZ_MARKERS: Mapping[str, str] = {
    "own": "*",
    "foreign": "square*",
}
TIKZ_COLORS: Mapping[str, str] = {
    "own": "ownColor",
    "foreign": "foreignColor",
}
TARGET_ORDER: tuple[str, ...] = (
    "Planted error",
    "Unstated rationale",
    "Background knowledge",
    "Failure mode",
)
TARGET_FILENAMES: Mapping[str, str] = {
    "Planted error": "planted_error_score_scatterplots",
    "Unstated rationale": "unstated_rationale_score_scatterplots",
    "Background knowledge": "background_knowledge_score_scatterplots",
    "Failure mode": "failure_mode_score_scatterplots",
    "Overall excluding Planted error": (
        "overall_excluding_planted_error_score_scatterplots"
    ),
}
OVERALL_EXCLUDING_PLANTED = "Overall excluding Planted error"
PLOT_TARGET_ORDER = (*TARGET_ORDER, OVERALL_EXCLUDING_PLANTED)
TARGET_LOOKUP: Mapping[str, str] = {
    "planted error": "Planted error",
    "unstated rationale": "Unstated rationale",
    "background knowledge": "Background knowledge",
    "background knowledgde": "Background knowledge",
    "background knowlegde": "Background knowledge",
    "failure mode": "Failure mode",
}
BOOLEAN_VALUES: Mapping[str, bool] = {
    "true": True,
    "1": True,
    "yes": True,
    "false": False,
    "0": False,
    "no": False,
}
JITTER_LIMIT = 0.06


def _require_columns(
    frame: pd.DataFrame, required: Iterable[str], source: Path
) -> None:
    missing = sorted(set(required) - set(frame.columns))
    if missing:
        raise ValueError(
            f"{source} is missing required column(s): {', '.join(missing)}."
        )


def _read_input(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(
            f"Input CSV not found: {path}. Supply the path to full_data_answers.csv."
        )
    try:
        frame = pd.read_csv(path)
    except pd.errors.EmptyDataError as exc:
        raise ValueError(f"Input CSV is empty: {path}.") from exc
    except pd.errors.ParserError as exc:
        raise ValueError(f"Could not parse {path} as CSV: {exc}") from exc
    aliases = {
        "condition": "paper_order",
        "block_position": "paper_position",
        "block_name": "question_target",
    }
    for source_column, canonical_column in aliases.items():
        if canonical_column not in frame.columns and source_column in frame.columns:
            frame = frame.rename(columns={source_column: canonical_column})
    _require_columns(frame, REQUIRED_COLUMNS, path)
    participant_ids = frame["participant_id"].astype("string").str.strip()
    experiment_rows = participant_ids.notna() & participant_ids.ne("")
    frame = frame.loc[experiment_rows].copy()
    if "warmup" in frame.columns:
        warmup = frame["warmup"].astype("string").str.strip().str.lower()
        invalid_warmup = ~warmup.isin({"", "true", "false", "1", "0", "yes", "no"})
        if invalid_warmup.any():
            raise ValueError(
                f"{path} contains unrecognized warmup values; expected "
                "true/false, 1/0, yes/no, or blank."
            )
        frame = frame.loc[~warmup.isin({"true", "1", "yes"})].copy()
    if frame.empty:
        raise ValueError(
            f"Input CSV contains no non-warmup experiment rows: {path}."
        )
    return frame.loc[:, REQUIRED_COLUMNS].copy()


def _format_examples(values: pd.Series, limit: int = 4) -> str:
    rendered = values.astype("string").fillna("<missing>")
    return ", ".join(rendered.drop_duplicates().head(limit))


def _parse_boolean_column(
    frame: pd.DataFrame, column: str, source: Path
) -> pd.Series:
    normalized = frame[column].astype("string").str.strip().str.lower()
    invalid = normalized.isna() | normalized.eq("") | ~normalized.isin(BOOLEAN_VALUES)
    if invalid.any():
        row_examples = ", ".join(
            f"row {index + 2}: {value}"
            for index, value in zip(
                frame.index[invalid][:4],
                normalized.loc[invalid].fillna("<missing>")[:4],
                strict=True,
            )
        )
        raise ValueError(
            f"{source} has invalid or missing {column} flag(s). Accepted values are "
            f"true/false, 1/0, and yes/no (case-insensitive). Examples: "
            f"{row_examples}."
        )
    return normalized.map(BOOLEAN_VALUES).astype(bool)


def validate_and_collapse(frame: pd.DataFrame, source: Path) -> pd.DataFrame:
    """Validate raw answer rows and calculate participant-target means."""
    frame["participant_id"] = frame["participant_id"].astype("string").str.strip()
    missing_ids = frame["participant_id"].isna() | frame["participant_id"].eq("")
    if missing_ids.any():
        raise ValueError(
            f"{source} contains missing participant_id values; every answer row "
            "must identify a participant."
        )

    original_positions = frame["paper_position"]
    numeric_positions = pd.to_numeric(original_positions, errors="coerce")
    invalid_positions = (
        numeric_positions.isna()
        | np.isinf(numeric_positions.to_numpy(dtype=float))
        | numeric_positions.mod(1).ne(0)
        | ~numeric_positions.isin([1, 2])
    )
    if invalid_positions.any():
        raise ValueError(
            "paper_position must be the integer 1 or 2 on every row; found: "
            f"{_format_examples(original_positions.loc[invalid_positions])}."
        )
    frame["paper_position"] = numeric_positions.astype(int)

    normalized_conditions = (
        frame["paper_order"].astype("string").str.strip().str.lower()
    )
    invalid_conditions = (
        normalized_conditions.isna()
        | normalized_conditions.eq("")
        | ~normalized_conditions.isin(CONDITION_ORDER)
    )
    if invalid_conditions.any():
        raise ValueError(
            "paper_order must contain only corrected values 'own' and 'foreign'; "
            f"found: {_format_examples(frame.loc[invalid_conditions, 'paper_order'])}. "
            "Condition is read directly and is not inferred from paper_position."
        )
    frame["paper_order"] = normalized_conditions

    normalized_targets = (
        frame["question_target"].astype("string").str.strip().str.lower()
    )
    canonical_targets = normalized_targets.map(TARGET_LOOKUP)
    for normalized_name, canonical_name in TARGET_LOOKUP.items():
        unresolved = canonical_targets.isna() & normalized_targets.str.contains(
            normalized_name,
            regex=False,
            na=False,
        )
        canonical_targets.loc[unresolved] = canonical_name
    invalid_targets = canonical_targets.isna()
    if invalid_targets.any():
        raise ValueError(
            "question_target must be Planted error, Unstated rationale, Background "
            "knowledge, or Failure mode (case/whitespace are normalized). Found: "
            f"{_format_examples(frame.loc[invalid_targets, 'question_target'])}."
        )
    frame["question_target"] = canonical_targets

    frame["skipped"] = _parse_boolean_column(frame, "skipped", source)
    frame["timed_out"] = _parse_boolean_column(frame, "timed_out", source)

    original_scores = frame["score"]
    score_text = original_scores.astype("string").str.strip()
    missing_scores = score_text.isna() | score_text.eq("")
    numeric_scores = pd.to_numeric(score_text.mask(missing_scores), errors="coerce")
    nonnumeric_scores = ~missing_scores & numeric_scores.isna()
    if nonnumeric_scores.any():
        raise ValueError(
            f"{source} has nonnumeric score value(s), including: "
            f"{_format_examples(original_scores.loc[nonnumeric_scores])}."
        )
    infinite_scores = numeric_scores.notna() & np.isinf(
        numeric_scores.fillna(0).to_numpy(dtype=float)
    )
    if infinite_scores.any():
        raise ValueError(
            f"{source} contains infinite score value(s), including: "
            f"{_format_examples(original_scores.loc[infinite_scores])}."
        )
    outside_scores = numeric_scores.notna() & (
        numeric_scores.lt(0) | numeric_scores.gt(100)
    )
    if outside_scores.any():
        raise ValueError(
            "score must be between 0 and 100 inclusive; found: "
            f"{_format_examples(original_scores.loc[outside_scores])}."
        )
    zero_scored = frame["skipped"] | frame["timed_out"]
    disallowed_missing = missing_scores & ~zero_scored
    if disallowed_missing.any():
        row_examples = ", ".join(
            f"row {index + 2}" for index in frame.index[disallowed_missing][:4]
        )
        raise ValueError(
            "Missing score is allowed only when skipped or timed_out is TRUE. "
            f"Missing score with both flags FALSE at {row_examples}."
        )
    frame["score"] = numeric_scores.astype(float)
    frame["score_analysis"] = frame["score"].where(~zero_scored, 0.0)

    test_keys = ["participant_id", "paper_position"]
    grouped = frame.groupby(test_keys, sort=True, dropna=False)
    test_sizes = grouped.size()
    wrong_sizes = test_sizes.loc[test_sizes.ne(8)]
    if not wrong_sizes.empty:
        examples = "; ".join(
            f"participant={key[0]}, paper_position={key[1]} has {count} rows"
            for key, count in wrong_sizes.head(4).items()
        )
        raise ValueError(
            "Every participant-paper_position test must contain exactly 8 answer "
            f"rows. Invalid test(s): {examples}."
        )

    condition_counts = grouped["paper_order"].nunique(dropna=False)
    inconsistent_conditions = condition_counts.loc[condition_counts.ne(1)]
    if not inconsistent_conditions.empty:
        examples = "; ".join(
            f"participant={key[0]}, paper_position={key[1]}"
            for key in inconsistent_conditions.head(4).index
        )
        raise ValueError(
            "paper_order must repeat unchanged across all 8 rows of each test. "
            f"Inconsistent test(s): {examples}."
        )

    target_counts = (
        frame.groupby(test_keys + ["question_target"], sort=True, dropna=False)
        .size()
        .unstack("question_target", fill_value=0)
        .reindex(columns=TARGET_ORDER, fill_value=0)
    )
    incorrect_targets = target_counts.loc[target_counts.ne(2).any(axis=1)]
    if not incorrect_targets.empty:
        examples = "; ".join(
            (
                f"participant={key[0]}, paper_position={key[1]} counts "
                + ", ".join(f"{target}={int(row[target])}" for target in TARGET_ORDER)
            )
            for key, row in incorrect_targets.head(4).iterrows()
        )
        raise ValueError(
            "Each test must contain exactly two rows of each question target. "
            f"Invalid test(s): {examples}."
        )

    tests = grouped.agg(condition=("paper_order", "first")).reset_index()
    participant_condition_counts = (
        tests.groupby(["participant_id", "condition"], sort=True)
        .size()
        .rename("test_count")
    )
    repeated_conditions = participant_condition_counts.loc[
        participant_condition_counts.ne(1)
    ]
    if not repeated_conditions.empty:
        examples = "; ".join(
            f"participant={key[0]}, condition={key[1]} has {count} tests"
            for key, count in repeated_conditions.head(4).items()
        )
        raise ValueError(
            "Each participant must have exactly one own test and one foreign test. "
            f"Repeated condition test(s): {examples}."
        )
    conditions_by_participant = tests.groupby("participant_id", sort=True)[
        "condition"
    ].agg(set)
    incomplete = conditions_by_participant.loc[
        conditions_by_participant.map(lambda values: values != set(CONDITION_ORDER))
    ]
    if not incomplete.empty:
        examples = "; ".join(
            f"participant={participant} has {sorted(conditions)}"
            for participant, conditions in incomplete.head(4).items()
        )
        raise ValueError(
            "Each participant must have exactly one 'own' and one 'foreign' test. "
            f"Incomplete participant(s): {examples}."
        )

    collapsed = (
        frame.groupby(
            ["participant_id", "paper_order", "question_target"],
            sort=True,
            dropna=False,
        )
        .agg(
            score_analysis=("score_analysis", "mean"),
            question_count=("score_analysis", "size"),
        )
        .reset_index()
        .rename(columns={"paper_order": "condition"})
    )
    wrong_collapsed_counts = collapsed["question_count"].ne(2)
    if wrong_collapsed_counts.any():
        raise ValueError(
            "Internal validation failed: every participant-condition-target point "
            "must average exactly two question rows."
        )
    outside_collapsed = (
        collapsed["score_analysis"].isna()
        | collapsed["score_analysis"].lt(0)
        | collapsed["score_analysis"].gt(100)
    )
    if outside_collapsed.any():
        raise ValueError(
            "Calculated participant-condition-target means must be between 0 and "
            "100 inclusive."
        )
    expected_points = len(conditions_by_participant) * len(CONDITION_ORDER) * len(
        TARGET_ORDER
    )
    duplicate_points = collapsed.duplicated(
        ["participant_id", "condition", "question_target"], keep=False
    )
    if duplicate_points.any() or len(collapsed) != expected_points:
        raise ValueError(
            "Expected exactly one point per participant-condition-target after "
            "collapsing the two question scores."
        )
    return collapsed


def _deterministic_jitter(
    pseudonym: object, question_target: str
) -> float:
    payload = f"{pseudonym!s}\0{question_target}".encode("utf-8")
    digest = hashlib.sha256(payload).digest()
    integer = int.from_bytes(digest[:8], byteorder="big", signed=False)
    unit = integer / float(2**64 - 1)
    return (2.0 * unit - 1.0) * JITTER_LIMIT


def prepare_export_data(collapsed: pd.DataFrame) -> pd.DataFrame:
    """Replace raw IDs with sequential pseudonyms and add stable jitter."""
    source_ids = sorted(
        collapsed["participant_id"].unique(), key=lambda value: str(value)
    )
    pseudonyms = {
        participant_id: f"P{index:03d}"
        for index, participant_id in enumerate(source_ids, start=1)
    }
    exported = collapsed.copy()
    exported["participant_id"] = exported["participant_id"].map(pseudonyms)
    exported["condition_label"] = exported["condition"].map(CONDITION_LABELS)
    exported["jitter"] = [
        _deterministic_jitter(pseudonym, target)
        for pseudonym, target in zip(
            exported["participant_id"],
            exported["question_target"],
            strict=True,
        )
    ]
    exported["x_position"] = exported["jitter"]
    condition_rank = {
        condition: index for index, condition in enumerate(CONDITION_ORDER)
    }
    target_rank = {target: index for index, target in enumerate(TARGET_ORDER)}
    exported["_condition_rank"] = exported["condition"].map(condition_rank)
    exported["_target_rank"] = exported["question_target"].map(target_rank)
    exported = exported.sort_values(
        ["_target_rank", "_condition_rank", "participant_id"], kind="stable"
    ).drop(columns=["_target_rank", "_condition_rank"])
    return exported.loc[
        :,
        [
            "participant_id",
            "condition",
            "condition_label",
            "question_target",
            "question_count",
            "score_analysis",
            "jitter",
            "x_position",
        ],
    ].reset_index(drop=True)


def prepare_non_planted_export(exported: pd.DataFrame) -> pd.DataFrame:
    """Pool the six non-planted questions for each participant condition."""
    pooled = (
        exported.loc[
            ~exported["question_target"].eq("Planted error")
        ]
        .groupby(
            ["participant_id", "condition", "condition_label"],
            sort=True,
            as_index=False,
        )
        .agg(
            question_count=("question_count", "sum"),
            score_analysis=("score_analysis", "mean"),
        )
    )
    pooled["question_target"] = OVERALL_EXCLUDING_PLANTED
    pooled["jitter"] = [
        _deterministic_jitter(participant, OVERALL_EXCLUDING_PLANTED)
        for participant in pooled["participant_id"]
    ]
    pooled["x_position"] = pooled["jitter"]
    return pooled.loc[:, exported.columns].copy()


def summarize_conditions(exported: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for target in PLOT_TARGET_ORDER:
        for condition in CONDITION_ORDER:
            values = exported.loc[
                exported["question_target"].eq(target)
                & exported["condition"].eq(condition),
                "score_analysis",
            ]
            rows.append(
                {
                    "question_target": target,
                    "condition": condition,
                    "condition_label": CONDITION_LABELS[condition],
                    "n": int(len(values)),
                    "mean": float(values.mean()),
                    "sd": (
                        float(values.std(ddof=1)) if len(values) > 1 else np.nan
                    ),
                    "median": float(values.median()),
                    "q1": float(values.quantile(0.25)),
                    "q3": float(values.quantile(0.75)),
                    "min": float(values.min()),
                    "max": float(values.max()),
                }
            )
    return pd.DataFrame(rows)


def calculate_roc_by_target(
    exported: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Calculate target-specific and non-planted unfamiliar-positive ROCs."""
    curve_frames: list[pd.DataFrame] = []
    metric_rows: list[dict[str, Any]] = []
    analysis_frames = [
        (
            target,
            exported.loc[exported["question_target"].eq(target)].copy(),
            "1 - score_analysis/100",
        )
        for target in TARGET_ORDER
    ]
    non_planted = (
        exported.loc[
            ~exported["question_target"].eq("Planted error")
        ]
        .groupby(
            ["participant_id", "condition"],
            sort=True,
            as_index=False,
        )
        .agg(score_analysis=("score_analysis", "mean"))
    )
    analysis_frames.append(
        (
            OVERALL_EXCLUDING_PLANTED,
            non_planted,
            "1 - mean_non_planted_score/100",
        )
    )

    for target, selected, prediction_score in analysis_frames:
        positive = selected["condition"].eq("foreign").astype(int)
        unfamiliarity_score = 1.0 - selected["score_analysis"].astype(float) / 100.0
        false_positive_rate, true_positive_rate, thresholds = roc_curve(
            positive,
            unfamiliarity_score,
            pos_label=1,
            drop_intermediate=False,
        )
        auc = float(roc_auc_score(positive, unfamiliarity_score))
        curve_frames.append(
            pd.DataFrame(
                {
                    "question_target": target,
                    "false_positive_rate": false_positive_rate,
                    "true_positive_rate": true_positive_rate,
                    "threshold": thresholds,
                }
            )
        )
        metric_rows.append(
            {
                "question_target": target,
                "auc": auc,
                "positive_class": "foreign",
                "negative_class": "own",
                "prediction_score": prediction_score,
                "n_positive": int(positive.sum()),
                "n_negative": int((1 - positive).sum()),
            }
        )
    return pd.concat(curve_frames, ignore_index=True), pd.DataFrame(metric_rows)


def build_description(
    target: str, target_summary: pd.DataFrame, auc: float
) -> tuple[str, str]:
    title = f"{target} scores and unfamiliar-label discrimination"
    indexed = target_summary.set_index("condition")
    if target == OVERALL_EXCLUDING_PLANTED:
        score_definition = (
            "Each point is one participant's arithmetic mean of the six questions "
            "from Unstated rationale, Background knowledge, and Failure mode for "
            "that condition."
        )
    else:
        score_definition = (
            "Each point is one participant's arithmetic mean of the two questions "
            "in this category for that condition."
        )
    description = (
        f"A two-panel figure for {target.lower()} questions. The left panel "
        "shows own-paper scores as blue circles in the left column and "
        "unfamiliar-paper scores as orange squares in the right column on a 0 to "
        "100 axis. A skipped or timed-out question is "
        f"scored zero. {score_definition} Both observations from a "
        "participant use comparable small deterministic horizontal jitter and are "
        "not connected. White diamonds mark condition means and colored horizontal "
        "segments mark medians. The own condition has "
        f"n={int(indexed.loc['own', 'n'])}, mean "
        f"{indexed.loc['own', 'mean']:.1f}, and median "
        f"{indexed.loc['own', 'median']:.1f}; the unfamiliar condition has "
        f"n={int(indexed.loc['foreign', 'n'])}, mean "
        f"{indexed.loc['foreign', 'mean']:.1f}, and median "
        f"{indexed.loc['foreign', 'median']:.1f}. The right panel uses one minus "
        "the score proportion to predict the unfamiliar label, which is the "
        f"positive class; its empirical ROC AUC is {auc:.3f}. The diagonal denotes "
        "chance-level discrimination. These are descriptive summaries only and do "
        "not support inferential or causal conclusions."
    )
    return title, description


def make_figure(
    exported: pd.DataFrame,
    target_summary: pd.DataFrame,
    target_roc: pd.DataFrame,
    auc: float,
    target: str,
) -> plt.Figure:
    figure, axes = plt.subplots(
        1,
        2,
        figsize=(10.2, 5.8),
        gridspec_kw={"wspace": 0.42, "width_ratios": [1.05, 1]},
    )
    indexed = target_summary.set_index("condition")
    score_axis, roc_axis = axes
    for condition_index, condition in enumerate(CONDITION_ORDER):
        selected = exported.loc[
            exported["question_target"].eq(target)
            & exported["condition"].eq(condition)
        ]
        color = CONDITION_COLORS[condition]
        score_axis.scatter(
            condition_index + 3 * selected["jitter"],
            selected["score_analysis"],
            s=42,
            marker=CONDITION_MARKERS[condition],
            facecolor=color,
            edgecolor="white",
            linewidth=0.55,
            alpha=0.82,
            zorder=3,
        )
        mean = float(indexed.loc[condition, "mean"])
        median = float(indexed.loc[condition, "median"])
        score_axis.scatter(
            [condition_index],
            [mean],
            marker="D",
            s=70,
            facecolor="white",
            edgecolor=color,
            linewidth=1.5,
            zorder=5,
        )
        score_axis.plot(
            [condition_index - 0.21, condition_index + 0.21],
            [median, median],
            color=color,
            linewidth=2.2,
            solid_capstyle="butt",
            zorder=4,
        )
    score_axis.set_xlim(-0.5, 1.5)
    score_axis.set_ylim(0, 100)
    score_axis.set_yticks(np.arange(0, 101, 20))
    score_axis.set_xticks(
        [0, 1],
        [
            f"Own\nn={int(indexed.loc['own', 'n'])}",
            f"Unfamiliar\nn={int(indexed.loc['foreign', 'n'])}",
        ],
    )
    score_axis.set_ylabel("Mean question score (0–100)")
    score_axis.grid(axis="y", color="#D9D9D9", linewidth=0.7, alpha=0.85)
    score_axis.set_axisbelow(True)
    score_axis.spines["top"].set_visible(False)
    score_axis.spines["right"].set_visible(False)
    score_axis.spines["bottom"].set_visible(False)

    roc_axis.plot(
        target_roc["false_positive_rate"],
        target_roc["true_positive_rate"],
        color="#5B3A9E",
        linewidth=2.3,
    )
    roc_axis.plot(
        [0, 1],
        [0, 1],
        color="#777777",
        linewidth=1.2,
        linestyle="--",
    )
    roc_axis.set_xlim(0, 1)
    roc_axis.set_ylim(0, 1.02)
    roc_axis.set_aspect("equal", adjustable="box")
    roc_axis.set_xlabel("False-positive rate")
    roc_axis.set_ylabel("True-positive rate")
    roc_axis.grid(color="#D9D9D9", linewidth=0.7, alpha=0.85)
    roc_axis.set_axisbelow(True)
    roc_axis.spines["top"].set_visible(False)
    roc_axis.spines["right"].set_visible(False)
    roc_axis.text(
        0.97,
        0.05,
        f"AUC = {auc:.3f}",
        transform=roc_axis.transAxes,
        ha="right",
        va="bottom",
        fontsize=11,
        bbox={
            "boxstyle": "round,pad=0.28",
            "facecolor": "white",
            "edgecolor": "#BBBBBB",
            "alpha": 0.92,
        },
    )

    figure.tight_layout()
    return figure


def _latex_escape(text: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
        "–": "--",
        "—": "---",
    }
    return "".join(replacements.get(character, character) for character in text)


def _coordinates(
    frame: pd.DataFrame, base_position: float = 0.0, jitter_scale: float = 1.0
) -> str:
    return " ".join(
        f"({base_position + jitter_scale * float(row.jitter):.10g},"
        f"{float(row.score_analysis):.10g})"
        for row in frame.itertuples(index=False)
    )


def write_tikz(
    path: Path,
    exported: pd.DataFrame,
    target_summary: pd.DataFrame,
    target_roc: pd.DataFrame,
    auc: float,
    target: str,
    description: str,
) -> None:
    indexed = target_summary.set_index("condition")
    lines = [
        "% Requires \\usepackage{pgfplots,pgfplotstable}.",
        "% Requires \\usepgfplotslibrary{groupplots}.",
        "% Requires \\usetikzlibrary{calc}.",
        "% Recommended: \\pgfplotsset{compat=1.18}.",
        "% acmart provides \\Description; outside acmart add:",
        "% \\providecommand{\\Description}[1]{}",
        r"\begingroup",
        r"\ifdefined\tikzexternaldisable\tikzexternaldisable\fi",
        r"\definecolor{ownColor}{HTML}{0072B2}",
        r"\definecolor{foreignColor}{HTML}{E69F00}",
        r"\definecolor{rocColor}{HTML}{5B3A9E}",
        r"\begin{tikzpicture}",
        r"\begin{groupplot}[",
        r"group style={group size=2 by 1,horizontal sep=0.16\linewidth},",
        r"scale only axis,",
        r"width=0.35\linewidth,height=0.35\linewidth,",
        r"axis lines*=left,axis line style={black!65,line width=0.5pt},",
        r"tick align=outside,tick style={black!65,line width=0.4pt},",
        r"major tick length=2pt,scaled ticks=false,ymajorgrids=true,",
        r"grid style={black!12,line width=0.35pt},",
        r"label style={font=\small},tick label style={font=\footnotesize},",
        r"]",
        (
            r"\nextgroupplot[xmin=-0.5,xmax=1.5,ymin=0,ymax=100,"
            r"xtick={0,1},"
            rf"xticklabels={{{{Own\\$n={int(indexed.loc['own', 'n'])}$}},"
            rf"{{Unfamiliar\\$n={int(indexed.loc['foreign', 'n'])}$}}}},"
            r"xticklabel style={align=center},ytick={0,20,40,60,80,100},"
            r"ylabel={Mean question score (0--100)},"
            r"]"
        ),
    ]
    for condition_index, condition in enumerate(CONDITION_ORDER):
        selected = exported.loc[
            exported["question_target"].eq(target)
            & exported["condition"].eq(condition)
        ]
        color = TIKZ_COLORS[condition]
        marker = TIKZ_MARKERS[condition]
        mean = float(indexed.loc[condition, "mean"])
        median = float(indexed.loc[condition, "median"])
        lines.extend(
            [
                (
                    rf"\addplot[only marks,mark={marker},mark size=2.5pt,"
                    rf"draw=white,fill={color},fill opacity=0.82] coordinates "
                    rf"{{{_coordinates(selected, condition_index, 3.0)}}};"
                ),
                (
                    rf"\addplot[forget plot,only marks,mark=diamond*,"
                    rf"mark size=3.4pt,"
                    rf"draw={color},fill=white,line width=0.8pt] coordinates "
                    rf"{{({condition_index},{mean:.10g})}};"
                ),
                (
                    rf"\draw[draw={color},line width=1.2pt] "
                    rf"(axis cs:{condition_index - 0.21:.2f},{median:.10g}) -- "
                    rf"(axis cs:{condition_index + 0.21:.2f},{median:.10g});"
                ),
            ]
        )
    roc_coordinates = " ".join(
        f"({float(row.false_positive_rate):.10g},"
        f"{float(row.true_positive_rate):.10g})"
        for row in target_roc.itertuples(index=False)
    )
    lines.extend(
        [
            (
                r"\nextgroupplot[xmin=0,xmax=1,ymin=0,ymax=1,"
                r"xtick={0,0.2,0.4,0.6,0.8,1},"
                r"ytick={0,0.2,0.4,0.6,0.8,1},"
                r"xlabel={False-positive rate},ylabel={True-positive rate},"
                r"]"
            ),
            (
                r"\addplot[forget plot,black!45,dashed,line width=0.7pt] coordinates "
                r"{(0,0) (1,1)};"
            ),
            (
                r"\addplot[forget plot,rocColor,line width=1.2pt] coordinates "
                rf"{{{roc_coordinates}}};"
            ),
            (
                rf"\node[anchor=south east,font=\small,fill=white,inner sep=3pt] "
                rf"at (axis cs:0.97,0.04) "
                rf"{{AUC = {auc:.3f}}};"
            ),
            r"\end{groupplot}",
            r"\end{tikzpicture}",
            rf"\Description{{{_latex_escape(description)}}}",
            r"\ifdefined\tikzexternalenable\tikzexternalenable\fi",
            r"\endgroup",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def write_all_plots(path: Path) -> None:
    lines = [
        (
            "% Native TikZ/PGFPlots generated by "
            "plot_participant_question_type_scores.py."
        ),
        "% Preamble requirements:",
        "% \\usepackage{tikz}",
        "% \\usepackage{pgfplots}",
        "% \\usepgfplotslibrary{groupplots}",
        "% \\usetikzlibrary{calc}",
        "% \\pgfplotsset{compat=1.18}",
        "% acmart provides \\Description.",
        "% For non-acmart classes: \\providecommand{\\Description}[1]{}",
        "% Paths assume compilation from the output root.",
    ]
    lines.extend(
        rf"\input{{latex/{TARGET_FILENAMES[target]}.tex}}"
        for target in PLOT_TARGET_ORDER
    )
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def run(input_path: Path, output_dir: Path) -> None:
    input_path = input_path.resolve()
    output_dir = output_dir.resolve()
    frame = _read_input(input_path)
    collapsed = validate_and_collapse(frame, input_path)
    exported = prepare_export_data(collapsed)
    non_planted_exported = prepare_non_planted_export(exported)
    plot_exported = pd.concat(
        [exported, non_planted_exported],
        ignore_index=True,
    )
    summary = summarize_conditions(plot_exported)
    roc_data, auc_summary = calculate_roc_by_target(exported)

    png_dir = output_dir / "png"
    latex_dir = output_dir / "latex"
    png_dir.mkdir(parents=True, exist_ok=True)
    latex_dir.mkdir(parents=True, exist_ok=True)

    descriptions: list[dict[str, str]] = []
    output_files: list[str] = []
    for target in PLOT_TARGET_ORDER:
        target_summary = summary.loc[summary["question_target"].eq(target)].copy()
        target_roc = roc_data.loc[
            roc_data["question_target"].eq(target)
        ].copy()
        auc = float(
            auc_summary.loc[
                auc_summary["question_target"].eq(target),
                "auc",
            ].iloc[0]
        )
        title, description = build_description(target, target_summary, auc)
        stem = TARGET_FILENAMES[target]
        png_relative = f"png/{stem}.png"
        tex_relative = f"latex/{stem}.tex"
        figure = make_figure(
            plot_exported,
            target_summary,
            target_roc,
            auc,
            target,
        )
        figure.savefig(
            output_dir / png_relative,
            dpi=260,
            bbox_inches="tight",
            facecolor="white",
            metadata={"Title": title, "Description": description},
        )
        plt.close(figure)
        write_tikz(
            output_dir / tex_relative,
            plot_exported,
            target_summary,
            target_roc,
            auc,
            target,
            description,
        )
        descriptions.append(
            {
                "question_target": target,
                "png_file": png_relative,
                "latex_file": tex_relative,
                "title": title,
                "description": description,
            }
        )
        output_files.extend([png_relative, tex_relative])

    exported.to_csv(
        output_dir / "participant_question_type_scores.csv", index=False
    )
    non_planted_exported.to_csv(
        output_dir / "participant_non_planted_scores.csv",
        index=False,
    )
    summary.to_csv(output_dir / "condition_summary.csv", index=False)
    roc_data.to_csv(output_dir / "roc_curves.csv", index=False)
    auc_summary.to_csv(output_dir / "roc_auc.csv", index=False)
    pd.DataFrame(descriptions).to_csv(
        output_dir / "plot_descriptions.csv", index=False
    )
    write_all_plots(latex_dir / "all_plots.tex")
    output_files.extend(
        [
            "latex/all_plots.tex",
            "plot_descriptions.csv",
            "participant_question_type_scores.csv",
            "participant_non_planted_scores.csv",
            "condition_summary.csv",
            "roc_curves.csv",
            "roc_auc.csv",
            "analysis_metadata.json",
        ]
    )

    metadata = {
        "source_path": str(input_path),
        "output_root": str(output_dir),
        "output_files": output_files,
        "package_requirements": {
            "python": ["pandas", "numpy", "matplotlib", "scikit-learn"],
            "latex": [
                "tikz",
                "pgfplots",
                "pgfplots groupplots library",
                "tikz calc library",
                "acmart Description or an equivalent provided command",
            ],
        },
        "condition_semantics": {
            "source_column": "paper_order",
            "own": "familiar",
            "foreign": "unfamiliar",
            "note": (
                "Corrected paper_order is used directly; condition is never "
                "inferred from paper_position."
            ),
        },
        "score_semantics": {
            "source_range": [0, 100],
            "zero_scored_when": ["skipped is true", "timed_out is true"],
            "point_definition": (
                "Arithmetic mean of the two score_analysis values for one "
                "participant, condition, and question target."
            ),
        },
        "roc": {
            "positive_class": "foreign",
            "negative_class": "own",
            "prediction_scores": {
                "question_target": "1 - score_analysis/100",
                "overall_excluding_planted_error": (
                    "1 - mean_non_planted_score/100"
                ),
            },
            "auc_by_question_target": {
                str(row.question_target): float(row.auc)
                for row in auc_summary.itertuples(index=False)
            },
            "overall_excluding_planted_error_definition": (
                "For each participant-condition test, arithmetic mean of the six "
                "score_analysis values from Unstated rationale, Background "
                "knowledge, and Failure mode; skipped and timed-out questions "
                "remain zero."
            ),
            "interpretation": (
                "For each category or the pooled non-planted score, AUC is the "
                "probability that a randomly selected foreign-paper test has a "
                "higher unfamiliarity score than a randomly selected own-paper "
                "test, with ties receiving half credit."
            ),
        },
        "validation": {
            "answer_rows_per_test": 8,
            "test_key": ["participant_id", "paper_position"],
            "required_tests_per_participant": ["own", "foreign"],
            "question_targets": list(TARGET_ORDER),
            "rows_per_target_per_test": 2,
            "accepted_boolean_values": list(BOOLEAN_VALUES),
        },
        "counts": {
            "raw_answer_rows": int(len(frame)),
            "participants": int(exported["participant_id"].nunique()),
            "participant_condition_target_points": int(len(exported)),
            "points_by_target_condition": {
                target: {
                    condition: int(
                        (
                            plot_exported["question_target"].eq(target)
                            & plot_exported["condition"].eq(condition)
                        ).sum()
                    )
                    for condition in CONDITION_ORDER
                }
                for target in PLOT_TARGET_ORDER
            },
        },
        "privacy": (
            "Raw participant IDs are replaced in exports by stable sequential "
            "pseudonyms based on sorted source IDs; raw IDs are not written."
        ),
        "jitter": {
            "method": (
                "First 64 bits of SHA-256 over exported pseudonym, a null separator, "
                "and canonical question target, mapped uniformly to [-0.06, 0.06]. "
                "The figure multiplies jitter by 3 around condition centers 0 "
                "(own) and 1 (unfamiliar). Raw participant IDs are not hashed."
            ),
            "deterministic": True,
            "substantive_meaning": False,
            "units": "panel x-axis",
        },
    }
    (output_dir / "analysis_metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Create overlaid participant question-target score plots and ROC "
            "curves from raw full_data_answers.csv."
        ),
        epilog=(
            "Python packages required: pandas, numpy, matplotlib, scikit-learn. "
            "Generated native LaTeX requires tikz, pgfplots, groupplots, and the "
            "TikZ calc library."
        ),
    )
    parser.add_argument(
        "input",
        type=Path,
        nargs="?",
        default=Path("research-captcha-answers-2026-09-10.csv"),
        help=(
            "Path to the ResearchCAPTCHA answer export (default: "
            "research-captcha-answers-2026-09-10.csv)."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("participant_question_type_score_plots"),
        help=(
            "Output directory. Existing directories are allowed; only this "
            "script's known output files are overwritten."
        ),
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        run(args.input, args.output_dir)
    except (FileNotFoundError, NotADirectoryError, OSError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
