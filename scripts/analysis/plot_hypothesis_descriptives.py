"""Create H1 and H2 descriptive score plots from final ordinal-beta outputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.lines import Line2D
from matplotlib.patches import Patch


TARGET_ORDER: tuple[str, ...] = (
    "Planted error",
    "Unstated rationale",
    "Background knowledge",
    "Failure mode",
)

H1_GROUPS: tuple[str, ...] = ("own", "foreign")
H2_GROUPS: tuple[str, ...] = ("in_field", "out_field")
GROUP_LABELS: Mapping[str, str] = {
    "own": "Own paper",
    "foreign": "Foreign paper",
    "in_field": "In-field",
    "out_field": "Out-of-field",
}
GROUP_COLORS: Mapping[str, str] = {
    "own": "#0072B2",
    "foreign": "#E69F00",
    "in_field": "#009E73",
    "out_field": "#D55E00",
}
GROUP_HATCHES: Mapping[str, str] = {
    "own": "///",
    "foreign": r"\\\\",
    "in_field": "xx",
    "out_field": "..",
}
GROUP_PATTERNS: Mapping[str, str] = {
    "own": "north east lines",
    "foreign": "north west lines",
    "in_field": "crosshatch",
    "out_field": "dots",
}
TIKZ_COLORS: Mapping[str, str] = {
    "own": "ownColor",
    "foreign": "foreignColor",
    "in_field": "inFieldColor",
    "out_field": "outFieldColor",
}

REQUIRED_DATA_COLUMNS: tuple[str, ...] = (
    "participant_id",
    "paper_type",
    "field_type",
    "question_target",
    "score_analysis",
)
SUMMARY_COLUMNS: tuple[str, ...] = (
    "hypothesis",
    "question_target",
    "group",
    "n",
    "participant_n",
    "mean",
    "sd",
    "median",
    "q1",
    "q3",
    "min",
    "max",
    "analysis_p_value",
    "analysis_p_value_semantics",
)


def _require_columns(
    frame: pd.DataFrame, required: Iterable[str], source: Path
) -> None:
    missing = sorted(set(required) - set(frame.columns))
    if missing:
        raise ValueError(
            f"{source} is missing required column(s): {', '.join(missing)}."
        )


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(
            f"Required input file not found: {path}. "
            "Run analyze_final_ordbeta.R first or set --analysis-dir."
        )
    try:
        return pd.read_csv(path)
    except pd.errors.EmptyDataError as exc:
        raise ValueError(f"Required input file is empty: {path}.") from exc
    except pd.errors.ParserError as exc:
        raise ValueError(f"Could not parse CSV input {path}: {exc}") from exc


def _numeric_column(
    frame: pd.DataFrame, column: str, source: Path, allow_missing: bool
) -> pd.Series:
    original = frame[column]
    converted = pd.to_numeric(original, errors="coerce")
    invalid = original.notna() & converted.isna()
    if invalid.any():
        examples = original.loc[invalid].astype(str).drop_duplicates().head(3)
        raise ValueError(
            f"{source} column {column!r} contains nonnumeric value(s), "
            f"including: {', '.join(examples)}."
        )
    if not allow_missing and converted.isna().any():
        raise ValueError(f"{source} column {column!r} contains missing values.")
    if np.isinf(converted.dropna().to_numpy(dtype=float)).any():
        raise ValueError(f"{source} column {column!r} contains infinite values.")
    return converted


def load_and_validate_inputs(
    analysis_dir: Path,
) -> tuple[
    pd.DataFrame,
    pd.DataFrame,
    float,
    pd.DataFrame,
    pd.DataFrame,
    dict[str, Path],
]:
    """Load required files and validate all plotting and p-value semantics."""
    paths = {
        "cleaned_question_level_data": analysis_dir
        / "cleaned_question_level_data.csv",
        "h1_primary_contrasts": analysis_dir / "h1_primary_contrasts.csv",
        "h2_primary_contrast": analysis_dir / "h2_primary_contrast.csv",
        "answered_only_data": analysis_dir / "sensitivity_answered_only_data.csv",
        "answered_h1_contrasts": analysis_dir
        / "sensitivity_answered_h1_contrasts.csv",
    }
    data = _read_csv(paths["cleaned_question_level_data"])
    h1 = _read_csv(paths["h1_primary_contrasts"])
    h2 = _read_csv(paths["h2_primary_contrast"])
    answered = _read_csv(paths["answered_only_data"])
    answered_h1 = _read_csv(paths["answered_h1_contrasts"])

    _require_columns(data, REQUIRED_DATA_COLUMNS, paths["cleaned_question_level_data"])
    _require_columns(
        h1,
        ("contrast", "question_target", "p.value.holm"),
        paths["h1_primary_contrasts"],
    )
    _require_columns(h2, ("contrast", "p.value"), paths["h2_primary_contrast"])
    _require_columns(
        answered,
        ("participant_id", "paper_type", "question_target", "score_analysis"),
        paths["answered_only_data"],
    )
    _require_columns(
        answered_h1,
        ("contrast", "question_target", "p.value.holm"),
        paths["answered_h1_contrasts"],
    )

    data = data.loc[:, REQUIRED_DATA_COLUMNS].copy()
    for column in ("paper_type", "field_type", "question_target"):
        data[column] = data[column].astype("string").str.strip()
    if data["participant_id"].isna().any():
        raise ValueError(
            f"{paths['cleaned_question_level_data']} contains missing participant_id "
            "values; participant counts would be ambiguous."
        )

    paper_values = set(data["paper_type"].dropna().unique())
    invalid_papers = sorted(paper_values - {"own", "foreign"})
    missing_papers = sorted({"own", "foreign"} - paper_values)
    if data["paper_type"].isna().any() or invalid_papers or missing_papers:
        detail = ", ".join(invalid_papers) if invalid_papers else "missing values"
        raise ValueError(
            "paper_type must contain both 'own' and 'foreign' and no other values; "
            f"invalid: {detail}; absent levels: {missing_papers or 'none'}."
        )

    targets = set(data["question_target"].dropna().unique())
    invalid_targets = sorted(targets - set(TARGET_ORDER))
    missing_targets = sorted(set(TARGET_ORDER) - targets)
    if data["question_target"].isna().any() or invalid_targets or missing_targets:
        detail = ", ".join(invalid_targets) if invalid_targets else "missing values"
        raise ValueError(
            "question_target must contain all four expected labels and no others; "
            f"invalid: {detail}; absent levels: {missing_targets or 'none'}."
        )

    foreign = data["paper_type"].eq("foreign")
    invalid_fields = sorted(
        set(data.loc[foreign, "field_type"].dropna().unique())
        - {"in_field", "out_field"}
    )
    if data.loc[foreign, "field_type"].isna().any() or invalid_fields:
        detail = ", ".join(invalid_fields) if invalid_fields else "missing values"
        raise ValueError(
            "Foreign-paper rows require field_type 'in_field' or 'out_field'; "
            f"found {detail} in {paths['cleaned_question_level_data']}."
        )
    observed_fields = set(data.loc[foreign, "field_type"].dropna().unique())
    missing_fields = sorted({"in_field", "out_field"} - observed_fields)
    if missing_fields:
        raise ValueError(
            "H2 plotting requires both foreign-paper field groups; "
            f"absent level(s): {', '.join(missing_fields)}."
        )
    participant_field_counts = (
        data.loc[foreign]
        .groupby("participant_id", observed=True)["field_type"]
        .nunique(dropna=True)
    )
    inconsistent_participants = participant_field_counts[
        participant_field_counts != 1
    ]
    if not inconsistent_participants.empty:
        examples = ", ".join(
            inconsistent_participants.index.astype(str).tolist()[:5]
        )
        raise ValueError(
            "Each participant must have exactly one foreign-paper field_type; "
            f"inconsistent participant(s) include: {examples}."
        )

    data["score_analysis"] = _numeric_column(
        data,
        "score_analysis",
        paths["cleaned_question_level_data"],
        allow_missing=True,
    )
    scores = data["score_analysis"].dropna()
    outside = scores.lt(0) | scores.gt(100)
    if outside.any():
        examples = ", ".join(f"{value:g}" for value in scores.loc[outside].head(3))
        raise ValueError(
            "score_analysis must be between 0 and 100 inclusive; "
            f"found {examples} in {paths['cleaned_question_level_data']}."
        )

    h1 = h1.loc[:, ["contrast", "question_target", "p.value.holm"]].copy()
    h1["contrast"] = h1["contrast"].astype("string").str.strip()
    if (
        h1["contrast"].isna().any()
        or not h1["contrast"].eq("own - foreign").all()
    ):
        found = sorted(h1["contrast"].dropna().unique())
        raise ValueError(
            "H1 contrast rows must all be labeled 'own - foreign'; "
            f"found: {found or 'missing values'}."
        )
    h1["question_target"] = h1["question_target"].astype("string").str.strip()
    h1["p.value.holm"] = _numeric_column(
        h1, "p.value.holm", paths["h1_primary_contrasts"], allow_missing=False
    )
    if h1["question_target"].duplicated().any():
        duplicates = h1.loc[
            h1["question_target"].duplicated(keep=False), "question_target"
        ].drop_duplicates()
        raise ValueError(
            "H1 contrasts must have exactly one row per question target; "
            f"duplicates: {', '.join(duplicates.astype(str))}."
        )
    if set(h1["question_target"]) != set(TARGET_ORDER):
        missing = sorted(set(TARGET_ORDER) - set(h1["question_target"]))
        extra = sorted(set(h1["question_target"]) - set(TARGET_ORDER))
        raise ValueError(
            "H1 contrasts must contain exactly the four expected targets. "
            f"Missing: {missing or 'none'}; unexpected: {extra or 'none'}."
        )
    if ((h1["p.value.holm"] < 0) | (h1["p.value.holm"] > 1)).any():
        raise ValueError("H1 p.value.holm values must be between 0 and 1.")
    h1 = h1.set_index("question_target").loc[list(TARGET_ORDER)].reset_index()

    h2_values = _numeric_column(
        h2, "p.value", paths["h2_primary_contrast"], allow_missing=False
    )
    if len(h2_values) != 1:
        raise ValueError(
            f"{paths['h2_primary_contrast']} must contain exactly one overall "
            f"field contrast row; found {len(h2_values)}."
        )
    h2_contrast = h2["contrast"].astype("string").str.strip()
    if (
        len(h2_contrast) != 1
        or h2_contrast.isna().any()
        or h2_contrast.iloc[0] != "in_field - out_field"
    ):
        found = h2_contrast.iloc[0] if len(h2_contrast) else "no row"
        raise ValueError(
            "H2 contrast must be labeled 'in_field - out_field'; "
            f"found {found!r}."
        )
    h2_p = float(h2_values.iloc[0])
    if not 0 <= h2_p <= 1:
        raise ValueError("H2 p.value must be between 0 and 1.")

    answered = answered.loc[
        :,
        ["participant_id", "paper_type", "question_target", "score_analysis"],
    ].copy()
    for column in ("paper_type", "question_target"):
        answered[column] = answered[column].astype("string").str.strip()
    if answered["participant_id"].isna().any():
        raise ValueError(
            f"{paths['answered_only_data']} contains missing participant_id values."
        )
    if (
        answered["paper_type"].isna().any()
        or set(answered["paper_type"].dropna().unique()) != {"own", "foreign"}
    ):
        raise ValueError(
            "Answered-only paper_type must contain exactly own and foreign."
        )
    if (
        answered["question_target"].isna().any()
        or set(answered["question_target"].dropna().unique()) != set(TARGET_ORDER)
    ):
        raise ValueError(
            "Answered-only question_target must contain all four expected labels."
        )
    answered["score_analysis"] = _numeric_column(
        answered,
        "score_analysis",
        paths["answered_only_data"],
        allow_missing=True,
    )
    answered_scores = answered["score_analysis"].dropna()
    if (answered_scores.lt(0) | answered_scores.gt(100)).any():
        raise ValueError("Answered-only score_analysis must be between 0 and 100.")

    answered_h1 = answered_h1.loc[
        :, ["contrast", "question_target", "p.value.holm"]
    ].copy()
    answered_h1["contrast"] = (
        answered_h1["contrast"].astype("string").str.strip()
    )
    answered_h1["question_target"] = (
        answered_h1["question_target"].astype("string").str.strip()
    )
    answered_h1["p.value.holm"] = _numeric_column(
        answered_h1,
        "p.value.holm",
        paths["answered_h1_contrasts"],
        allow_missing=False,
    )
    if (
        answered_h1["contrast"].isna().any()
        or not answered_h1["contrast"].eq("own - foreign").all()
        or answered_h1["question_target"].duplicated().any()
        or set(answered_h1["question_target"]) != set(TARGET_ORDER)
        or (
            (answered_h1["p.value.holm"] < 0)
            | (answered_h1["p.value.holm"] > 1)
        ).any()
    ):
        raise ValueError(
            "Answered-only H1 contrasts must contain one valid own-minus-foreign "
            "Holm-adjusted result for each question target."
        )
    answered_h1 = (
        answered_h1.set_index("question_target")
        .loc[list(TARGET_ORDER)]
        .reset_index()
    )

    return data, h1, h2_p, answered, answered_h1, paths


def _stats(values: pd.Series) -> dict[str, Any]:
    if values.empty:
        return {
            "n": 0,
            "mean": np.nan,
            "sd": np.nan,
            "median": np.nan,
            "q1": np.nan,
            "q3": np.nan,
            "min": np.nan,
            "max": np.nan,
        }
    return {
        "n": int(len(values)),
        "mean": float(values.mean()),
        "sd": float(values.std(ddof=1)) if len(values) > 1 else np.nan,
        "median": float(values.median()),
        "q1": float(values.quantile(0.25)),
        "q3": float(values.quantile(0.75)),
        "min": float(values.min()),
        "max": float(values.max()),
    }


def build_plot_frames_and_summary(
    data: pd.DataFrame,
    h1: pd.DataFrame,
    h2_p: float,
    answered: pd.DataFrame,
    answered_h1: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Drop only missing scores, derive groups, and create descriptive summaries."""
    plotted = data.loc[data["score_analysis"].notna()].copy()
    h1_frame = plotted.copy()
    h1_frame["group"] = h1_frame["paper_type"]
    h2_frame = plotted.loc[plotted["paper_type"].eq("foreign")].copy()
    h2_frame["group"] = h2_frame["field_type"]
    h1_p = h1.set_index("question_target")["p.value.holm"].to_dict()
    answered_frame = answered.loc[answered["score_analysis"].notna()].copy()
    answered_frame["group"] = answered_frame["paper_type"]
    answered_h1_p = (
        answered_h1.set_index("question_target")["p.value.holm"].to_dict()
    )

    rows: list[dict[str, Any]] = []
    for hypothesis, frame, groups in (
        ("H1", h1_frame, H1_GROUPS),
        ("H2", h2_frame, H2_GROUPS),
        ("H1_answered_only", answered_frame, H1_GROUPS),
    ):
        for target in TARGET_ORDER:
            for group in groups:
                selected = frame.loc[
                    frame["question_target"].eq(target) & frame["group"].eq(group)
                ]
                values = selected["score_analysis"]
                if hypothesis == "H1":
                    p_value = float(h1_p[target])
                    semantics = (
                        "Holm-adjusted model-derived own-versus-foreign "
                        "ordered-beta link-scale contrast"
                    )
                elif hypothesis == "H1_answered_only":
                    p_value = float(answered_h1_p[target])
                    semantics = (
                        "Holm-adjusted answered-only model-derived "
                        "own-versus-foreign ordered-beta link-scale contrast"
                    )
                else:
                    p_value = h2_p
                    semantics = (
                        "Overall adjusted-model in-field-versus-out-of-field "
                        "contrast"
                    )
                rows.append(
                    {
                        "hypothesis": hypothesis,
                        "question_target": target,
                        "group": group,
                        **_stats(values),
                        "participant_n": int(selected["participant_id"].nunique()),
                        "analysis_p_value": p_value,
                        "analysis_p_value_semantics": semantics,
                    }
                )
    summary = pd.DataFrame(rows).loc[:, SUMMARY_COLUMNS]
    return h1_frame, h2_frame, answered_frame, summary


def _format_p(value: float) -> str:
    return f"{value:.3g}"


def _draw_box(
    ax: plt.Axes,
    values: np.ndarray,
    position: float,
    group: str,
    width: float,
) -> None:
    values = values[np.isfinite(values)]
    if not len(values):
        return
    color = GROUP_COLORS[group]
    ax.boxplot(
        [values],
        positions=[position],
        widths=width,
        patch_artist=True,
        showmeans=True,
        whis=1.5,
        boxprops={
            "facecolor": color,
            "edgecolor": color,
            "alpha": 0.45,
            "linewidth": 1.0,
            "hatch": GROUP_HATCHES[group],
        },
        medianprops={"color": "black", "linewidth": 1.4},
        whiskerprops={"color": color, "linewidth": 1.0},
        capprops={"color": color, "linewidth": 1.0},
        flierprops={
            "marker": "o",
            "markersize": 3,
            "markerfacecolor": color,
            "markeredgecolor": color,
            "alpha": 0.5,
        },
        meanprops={
            "marker": "D",
            "markersize": 5,
            "markerfacecolor": "white",
            "markeredgecolor": color,
            "markeredgewidth": 1.0,
        },
    )


def _style_axis(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#D9D9D9", linewidth=0.7, alpha=0.85)
    ax.set_axisbelow(True)
    ax.set_ylim(0, 100)
    ax.set_yticks(np.arange(0, 101, 20))
    ax.set_ylabel("Score (0–100)")
    ax.set_xticks(range(len(TARGET_ORDER)))
    ax.set_xticklabels(TARGET_ORDER)
    ax.set_xlim(-0.6, len(TARGET_ORDER) - 0.4)


def _legend(ax: plt.Axes, groups: Sequence[str]) -> None:
    handles: list[Any] = [
        Patch(
            facecolor=GROUP_COLORS[group],
            edgecolor=GROUP_COLORS[group],
            alpha=0.45,
            hatch=GROUP_HATCHES[group],
            label=GROUP_LABELS[group],
        )
        for group in groups
    ]
    handles.append(
        Line2D(
            [0],
            [0],
            marker="D",
            linestyle="none",
            markerfacecolor="white",
            markeredgecolor="#333333",
            markersize=5,
            label="Mean",
        )
    )
    ax.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.15),
        ncol=3,
        frameon=False,
    )


def make_h1_figure(
    frame: pd.DataFrame,
    p_values: Mapping[str, float],
    title: str = "H1: Score distributions by paper type",
) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(12.0, 6.8))
    offsets = (-0.18, 0.18)
    width = 0.30
    for target_index, target in enumerate(TARGET_ORDER):
        for group_index, group in enumerate(H1_GROUPS):
            position = target_index + offsets[group_index]
            values = frame.loc[
                frame["question_target"].eq(target) & frame["group"].eq(group),
                "score_analysis",
            ].to_numpy(dtype=float)
            _draw_box(ax, values, position, group, width)
            ax.text(
                position,
                1.01,
                f"n={len(values)}",
                transform=ax.get_xaxis_transform(),
                ha="center",
                va="bottom",
                fontsize=7.5,
                color=GROUP_COLORS[group],
                bbox={
                    "facecolor": "white",
                    "alpha": 0.72,
                    "edgecolor": "none",
                    "pad": 0.5,
                },
                clip_on=False,
                zorder=5,
            )
        left = target_index + offsets[0]
        right = target_index + offsets[1]
        ax.plot(
            [left, left, right, right],
            [1.055, 1.075, 1.075, 1.055],
            transform=ax.get_xaxis_transform(),
            color="#333333",
            linewidth=0.8,
            clip_on=False,
        )
        ax.text(
            target_index,
            1.082,
            f"Holm-adjusted p={_format_p(float(p_values[target]))}",
            transform=ax.get_xaxis_transform(),
            ha="center",
            va="bottom",
            fontsize=8,
            clip_on=False,
        )
    _style_axis(ax)
    ax.set_title(title, pad=58)
    _legend(ax, H1_GROUPS)
    fig.tight_layout(rect=(0, 0.08, 1, 0.91))
    return fig


def make_h2_figure(frame: pd.DataFrame, p_value: float) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(12.0, 6.8))
    offsets = (-0.18, 0.18)
    width = 0.30
    for target_index, target in enumerate(TARGET_ORDER):
        for group_index, group in enumerate(H2_GROUPS):
            position = target_index + offsets[group_index]
            values = frame.loc[
                frame["question_target"].eq(target) & frame["group"].eq(group),
                "score_analysis",
            ].to_numpy(dtype=float)
            _draw_box(ax, values, position, group, width)
            ax.text(
                position,
                1.01,
                f"n={len(values)}",
                transform=ax.get_xaxis_transform(),
                ha="center",
                va="bottom",
                fontsize=7.5,
                color=GROUP_COLORS[group],
                bbox={
                    "facecolor": "white",
                    "alpha": 0.72,
                    "edgecolor": "none",
                    "pad": 0.5,
                },
                clip_on=False,
                zorder=5,
            )
    _style_axis(ax)
    ax.set_title(
        "H2: Foreign-paper scores by field match\n"
        f"Overall field effect: p={_format_p(p_value)}",
        pad=24,
    )
    _legend(ax, H2_GROUPS)
    fig.tight_layout(rect=(0, 0.08, 1, 0.93))
    return fig


def _trend_text(
    summary: pd.DataFrame, hypothesis: str, groups: Sequence[str]
) -> str:
    parts: list[str] = []
    subset = summary.loc[summary["hypothesis"].eq(hypothesis)]
    for target in TARGET_ORDER:
        target_rows = subset.loc[subset["question_target"].eq(target)].set_index("group")
        if any(int(target_rows.loc[group, "n"]) == 0 for group in groups):
            parts.append(f"{target} had insufficient observations for one or more groups")
            continue
        first, second = groups
        parts.append(
            f"{target}: median {target_rows.loc[first, 'median']:.1f} versus "
            f"{target_rows.loc[second, 'median']:.1f}, and mean "
            f"{target_rows.loc[first, 'mean']:.1f} versus "
            f"{target_rows.loc[second, 'mean']:.1f}"
        )
    return "; ".join(parts) + "."


def build_descriptions(
    summary: pd.DataFrame, h2_p: float
) -> dict[str, dict[str, str]]:
    common = (
        "Grouped box-and-whisker chart with question target on the x-axis in the "
        "order Planted error, Unstated rationale, Background knowledge, and Failure "
        "mode, and complete timed-test score_analysis from 0 to 100 on the y-axis, "
        "including zero-scored skips and timeouts. Each n is a question-row count; "
        "unique participant counts are reported in plotted_summary.csv. Boxes span "
        "the first and third quartiles, black lines mark medians, whiskers extend to "
        "the most extreme values within 1.5 interquartile ranges, dots mark outliers, "
        "and white diamonds mark means. "
    )
    h1 = (
        common
        + "Within each target, Own paper is first in blue with northeast-line "
        "hatching and Foreign paper is second in orange with northwest-line hatching; "
        "all foreign papers are collapsed across in-field and out-of-field status. "
        "Each target is annotated with its model-derived own-versus-foreign "
        "ordered-beta link-scale contrast p.value.holm from h1_primary_contrasts.csv, "
        "Holm-adjusted across the four planned contrasts; these p-values are not tests "
        "calculated from the displayed box plots. Descriptive trend (own versus foreign): "
        + _trend_text(summary, "H1", H1_GROUPS)
        + " These descriptive differences do not establish causation."
    )
    h2 = (
        common
        + "Within each target, In-field is first in green with crosshatch pattern and "
        "Out-of-field is second in vermillion with dot pattern; only foreign-paper "
        "rows are shown. The overall adjusted-model field effect is "
        f"p.value={_format_p(h2_p)} from h2_primary_contrast.csv; it is displayed "
        "on the PNG but omitted from the compact manuscript LaTeX layout. It is not "
        "a category-specific test and has no multiple-comparison correction. "
        "Descriptive trend (in-field versus out-of-field): "
        + _trend_text(summary, "H2", H2_GROUPS)
        + " These descriptive differences do not establish causation."
    )
    answered_only = (
        "Grouped box-and-whisker chart with question target on the x-axis in the "
        "order Planted error, Unstated rationale, Background knowledge, and Failure "
        "mode, and answered-question score from 0 to 100 on the y-axis. Skipped, "
        "timed-out, and unknown-response-status questions are excluded. Each n is a "
        "nonmissing answered "
        "question-row count; unique participant counts are reported in "
        "plotted_summary.csv. Boxes span the first and third quartiles, black lines "
        "mark medians, whiskers extend to the most extreme values within 1.5 "
        "interquartile ranges, dots mark outliers, and white diamonds mark means. "
        "Within each target, Own paper is first in blue with northeast-line hatching "
        "and Foreign paper is second in orange with northwest-line hatching; foreign "
        "papers are collapsed across field status. Each target is annotated with its "
        "answered-only, model-derived own-versus-foreign ordered-beta link-scale "
        "p.value.holm, Holm-adjusted across four planned contrasts; these p-values "
        "are not tests calculated from the boxes. Descriptive trend (own versus "
        "foreign): "
        + _trend_text(summary, "H1_answered_only", H1_GROUPS)
        + " This appendix sensitivity plot describes performance conditional on an "
        "observed response and does not establish why questions were unanswered."
    )
    return {
        "h1_score_distribution.png": {
            "title": "H1 score distributions by paper type",
            "description": h1,
        },
        "h2_field_score_distribution.png": {
            "title": "H2 foreign-paper score distributions by field match",
            "description": h2,
        },
        "h1_answered_only_score_distribution.png": {
            "title": "H1 answered-only score distributions by paper type",
            "description": answered_only,
        },
    }


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


def _tikz_color_lines(groups: Sequence[str]) -> list[str]:
    return [
        rf"\definecolor{{{TIKZ_COLORS[group]}}}{{HTML}}{{"
        f"{GROUP_COLORS[group].lstrip('#')}}}"
        for group in groups
    ]


def _box_statistics(values: np.ndarray) -> dict[str, Any] | None:
    values = values[np.isfinite(values)]
    if not len(values):
        return None
    q1, median, q3 = np.quantile(values, [0.25, 0.5, 0.75])
    iqr = q3 - q1
    lower = float(values[values >= q1 - 1.5 * iqr].min())
    upper = float(values[values <= q3 + 1.5 * iqr].max())
    return {
        "q1": float(q1),
        "median": float(median),
        "q3": float(q3),
        "lower": lower,
        "upper": upper,
        "mean": float(values.mean()),
        "outliers": values[(values < lower) | (values > upper)],
    }


def _tikz_box_lines(
    values: np.ndarray, position: float, group: str, width: float
) -> list[str]:
    stats = _box_statistics(values)
    if stats is None:
        return []
    color = TIKZ_COLORS[group]
    half = width / 2
    cap = width * 0.28
    lines = [
        (
            rf"\draw[draw={color},fill={color}!12,pattern={GROUP_PATTERNS[group]},"
            rf"pattern color={color},line width=0.6pt] "
            rf"(axis cs:{position-half:.6g},{stats['q1']:.8g}) rectangle "
            rf"(axis cs:{position+half:.6g},{stats['q3']:.8g});"
        ),
        (
            rf"\draw[draw={color}] (axis cs:{position:.6g},{stats['lower']:.8g}) "
            rf"-- (axis cs:{position:.6g},{stats['q1']:.8g});"
        ),
        (
            rf"\draw[draw={color}] (axis cs:{position:.6g},{stats['q3']:.8g}) "
            rf"-- (axis cs:{position:.6g},{stats['upper']:.8g});"
        ),
        (
            rf"\draw[draw={color}] (axis cs:{position-cap:.6g},{stats['lower']:.8g}) "
            rf"-- (axis cs:{position+cap:.6g},{stats['lower']:.8g});"
        ),
        (
            rf"\draw[draw={color}] (axis cs:{position-cap:.6g},{stats['upper']:.8g}) "
            rf"-- (axis cs:{position+cap:.6g},{stats['upper']:.8g});"
        ),
        (
            rf"\draw[draw=black,line width=0.9pt] "
            rf"(axis cs:{position-half:.6g},{stats['median']:.8g}) -- "
            rf"(axis cs:{position+half:.6g},{stats['median']:.8g});"
        ),
        (
            rf"\addplot[forget plot,only marks,mark=diamond*,mark size=2.4pt,"
            rf"draw={color},fill=white] coordinates "
            rf"{{({position:.6g},{stats['mean']:.8g})}};"
        ),
    ]
    outliers = stats["outliers"]
    if len(outliers):
        coordinates = " ".join(
            f"({position:.6g},{float(value):.8g})" for value in outliers
        )
        lines.append(
            rf"\addplot[forget plot,only marks,mark=*,mark size=1.2pt,"
            rf"draw={color},fill={color},fill opacity=0.5] "
            rf"coordinates {{{coordinates}}};"
        )
    return lines


def _tikz_legend_lines(groups: Sequence[str]) -> list[str]:
    lines: list[str] = []
    for group in groups:
        color = TIKZ_COLORS[group]
        lines.extend(
            [
                (
                    r"\addlegendimage{legend image code/.code={"
                    rf"\draw[draw={color},fill={color}!12,"
                    rf"pattern={GROUP_PATTERNS[group]},pattern color={color}] "
                    r"(0cm,-0.08cm) rectangle (0.34cm,0.08cm);}}"
                ),
                rf"\addlegendentry{{{_latex_escape(GROUP_LABELS[group])}}}",
            ]
        )
    lines.extend(
        [
            r"\addlegendimage{only marks,mark=diamond*,mark size=2.4pt,draw=black,fill=white}",
            r"\addlegendentry{Mean}",
        ]
    )
    return lines


def _significance_label(p_value: float) -> str:
    if p_value < 0.001:
        return "***"
    if p_value < 0.01:
        return "**"
    if p_value < 0.05:
        return "*"
    return "ns"


def write_h1_tikz_plot(
    path: Path,
    frame: pd.DataFrame,
    description: str,
    p_values: Mapping[str, float],
    answered_only: bool = False,
) -> None:
    """Write the manuscript's compact H1 paper-comparison layout."""
    box_command = "answeredBox" if answered_only else "scoreBox"
    significance_command = (
        "answeredSignificance" if answered_only else "scoreSignificance"
    )
    lines = [
        "% Requires:",
        "% \\usepackage{pgfplots}",
        "% \\usetikzlibrary{patterns}",
        "% \\pgfplotsset{compat=1.18}",
        "",
    ]
    if answered_only:
        lines.extend([r"\begin{figure}[t]", r"\centering"])
    lines.extend(
        [
            r"\begingroup",
            r"\ifdefined\tikzexternaldisable\tikzexternaldisable\fi",
            r"\definecolor{ownColor}{HTML}{0072B2}",
            r"\definecolor{foreignColor}{HTML}{E69F00}",
            "",
            "% Arguments:",
            "% x, Q1, Q3, median, lower whisker, upper whisker, mean, color, pattern",
            rf"\newcommand{{\{box_command}}}[9]{{%",
            r"  \path[",
            r"    draw=#8,",
            r"    fill=#8!12,",
            r"    pattern=#9,",
            r"    pattern color=#8,",
            r"    line width=0.7pt",
            r"  ]",
            r"    (axis cs:{#1-0.15},#2)",
            r"    rectangle",
            r"    (axis cs:{#1+0.15},#3);",
            r"  \draw[draw=#8,line width=0.7pt]",
            r"    (axis cs:#1,#5) -- (axis cs:#1,#2)",
            r"    (axis cs:#1,#3) -- (axis cs:#1,#6)",
            r"    (axis cs:{#1-0.084},#5) -- (axis cs:{#1+0.084},#5)",
            r"    (axis cs:{#1-0.084},#6) -- (axis cs:{#1+0.084},#6);",
            r"  \draw[black,line width=1pt]",
            r"    (axis cs:{#1-0.15},#4) -- (axis cs:{#1+0.15},#4);",
            r"  \addplot[",
            r"    forget plot,",
            r"    only marks,",
            r"    mark=diamond*,",
            r"    mark size=2.8pt,",
            r"    draw=#8,",
            r"    fill=white",
            r"  ] coordinates {(#1,#7)};",
            r"}",
            "",
            rf"\newcommand{{\{significance_command}}}[2]{{%",
            r"  \draw[black,line width=0.6pt]",
            r"    (axis cs:{#1-0.18},103)",
            r"    -- (axis cs:{#1-0.18},106)",
            r"    -- (axis cs:{#1+0.18},106)",
            r"    -- (axis cs:{#1+0.18},103);",
            r"  \node[anchor=south,font=\normalsize,inner sep=1pt]",
            r"    at (axis cs:#1,106) {#2};",
            r"}",
            "",
            r"\begin{tikzpicture}",
            r"\begin{axis}[",
            r"  width=0.98\linewidth,",
            r"  height=0.48\linewidth,",
            r"  xmin=-0.48,xmax=3.48,",
            r"  ymin=0,ymax=113,",
            r"  ylabel={Score (0--100)},",
            r"  label style={font=\normalsize},",
            r"  tick label style={font=\normalsize},",
            r"  xtick={0,1,2,3},",
            r"  xticklabels={",
        ]
    )

    for target in TARGET_ORDER:
        split_label = target.replace(" ", r"\\")
        if answered_only:
            counts = []
            for group in H1_GROUPS:
                counts.append(
                    int(
                        frame.loc[
                            frame["question_target"].eq(target)
                            & frame["group"].eq(group),
                            "score_analysis",
                        ].notna().sum()
                    )
                )
            split_label += rf"\\$n={counts[0]}/{counts[1]}$"
        comma = "," if target != TARGET_ORDER[-1] else ""
        lines.append(rf"    {{{split_label}}}{comma}")

    lines.extend(
        [
            r"  },",
            r"  xticklabel style={align=center},",
            r"  ytick={0,20,40,60,80,100},",
            r"  tick align=outside,",
            r"  axis lines*=left,",
            r"  ymajorgrids,",
            r"  grid style={draw=gray!25,line width=0.4pt},",
            r"  clip=false,",
            r"  legend style={",
            r"    at={(0.5,0)},",
            r"    anchor=north,",
            (
                r"    yshift=-4.5em,"
                if answered_only
                else r"    yshift=-3.2em,"
            ),
            r"    draw=none,",
            r"    font=\normalsize,",
            r"    legend columns=3,",
            r"    /tikz/every even column/.append style={column sep=0.8em}",
            r"  },",
            r"]",
        ]
    )

    offsets = {"own": -0.18, "foreign": 0.18}
    group_counts: dict[str, list[int]] = {group: [] for group in H1_GROUPS}
    for target_index, target in enumerate(TARGET_ORDER):
        lines.extend(["", f"% {target}"])
        for group in H1_GROUPS:
            values = frame.loc[
                frame["question_target"].eq(target)
                & frame["group"].eq(group),
                "score_analysis",
            ].to_numpy(dtype=float)
            stats = _box_statistics(values)
            if stats is None:
                continue
            group_counts[group].append(len(values))
            position = target_index + offsets[group]
            color = TIKZ_COLORS[group]
            pattern = GROUP_PATTERNS[group]
            lines.extend(
                [
                    (
                        rf"\{box_command}{{{position:.2f}}}"
                        rf"{{{stats['q1']:.8g}}}{{{stats['q3']:.8g}}}"
                        rf"{{{stats['median']:.8g}}}{{{stats['lower']:.8g}}}"
                        rf"{{{stats['upper']:.8g}}}{{{stats['mean']:.8g}}}"
                    ),
                    rf"  {{{color}}}{{{pattern}}}",
                ]
            )
            outliers = stats["outliers"]
            if len(outliers):
                coordinates = " ".join(
                    f"({position:.2f},{float(value):.8g})"
                    for value in outliers
                )
                lines.extend(
                    [
                        "",
                        r"\addplot[",
                        r"  forget plot,only marks,mark=*,",
                        r"  mark size=1.5pt,",
                        rf"  draw={color},fill={color},fill opacity=0.5",
                        rf"] coordinates {{{coordinates}}};",
                    ]
                )
        lines.extend(
            [
                (
                    rf"\{significance_command}{{{target_index}}}"
                    rf"{{{_significance_label(float(p_values[target]))}}}"
                )
            ]
        )

    legend_labels = {
        "own": "Own paper",
        "foreign": "Foreign paper" if answered_only else "Unfamiliar paper",
    }
    lines.extend(["", "% Legend: sample size applies to each box."])
    for group in H1_GROUPS:
        color = TIKZ_COLORS[group]
        pattern = GROUP_PATTERNS[group]
        label = legend_labels[group]
        if not answered_only:
            observed_counts = sorted(set(group_counts[group]))
            n_label = (
                str(observed_counts[0])
                if len(observed_counts) == 1
                else "varies"
            )
            label += rf" ($n={n_label}$)"
        lines.extend(
            [
                r"\addlegendimage{",
                r"  legend image code/.code={",
                r"    \draw[",
                rf"      draw={color},",
                rf"      fill={color}!12,",
                rf"      pattern={pattern},",
                rf"      pattern color={color}",
                r"    ] (0cm,-0.09cm) rectangle (0.34cm,0.09cm);",
                r"  }",
                r"}",
                rf"\addlegendentry{{{label}}}",
                "",
            ]
        )

    lines.extend(
        [
            r"\addlegendimage{",
            r"  only marks,mark=diamond*,mark size=2.8pt,",
            r"  draw=black,fill=white",
            r"}",
            r"\addlegendentry{Mean}",
            "",
            r"\end{axis}",
            r"\end{tikzpicture}",
            r"\ifdefined\tikzexternalenable\tikzexternalenable\fi",
            r"\endgroup",
        ]
    )
    if answered_only:
        lines.extend(
            [
                "",
                (
                    r"\caption{Score distributions for answered questions only, "
                    r"grouped by question family and paper type. Sample sizes show "
                    r"the counts of responses to question sets based on own/unfamiliar "
                    r"paper. Diamonds indicate means. Brackets report Holm-adjusted "
                    r"comparisons (*** $p<.001$; ns, not significant).}"
                ),
                r"\label{fig:h1_answered_only_score_distribution}",
                "",
                rf"\Description{{{_latex_escape(description)}}}",
                "",
                r"\end{figure}",
            ]
        )
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_h2_tikz_plot(
    path: Path,
    frame: pd.DataFrame,
    description: str,
) -> None:
    """Write the manuscript's compact H2 field-comparison layout."""
    lines = [
        "% Requires:",
        "% \\usepackage{pgfplots}",
        "% \\usetikzlibrary{patterns}",
        "% \\pgfplotsset{compat=1.18}",
        "",
        r"\begingroup",
        r"\ifdefined\tikzexternaldisable\tikzexternaldisable\fi",
        r"\definecolor{inFieldColor}{HTML}{009E73}",
        r"\definecolor{outFieldColor}{HTML}{D55E00}",
        "",
        "% Arguments:",
        "% x, Q1, Q3, median, lower whisker, upper whisker, mean, color, pattern",
        r"\newcommand{\fieldBox}[9]{%",
        r"  \path[",
        r"    draw=#8,",
        r"    fill=#8!12,",
        r"    pattern=#9,",
        r"    pattern color=#8,",
        r"    line width=0.7pt",
        r"  ]",
        r"    (axis cs:{#1-0.15},#2)",
        r"    rectangle",
        r"    (axis cs:{#1+0.15},#3);",
        r"  \draw[draw=#8,line width=0.7pt]",
        r"    (axis cs:#1,#5) -- (axis cs:#1,#2)",
        r"    (axis cs:#1,#3) -- (axis cs:#1,#6)",
        r"    (axis cs:{#1-0.084},#5) -- (axis cs:{#1+0.084},#5)",
        r"    (axis cs:{#1-0.084},#6) -- (axis cs:{#1+0.084},#6);",
        r"  \draw[black,line width=1pt]",
        r"    (axis cs:{#1-0.15},#4) -- (axis cs:{#1+0.15},#4);",
        r"  \addplot[",
        r"    forget plot,",
        r"    only marks,",
        r"    mark=diamond*,",
        r"    mark size=2.8pt,",
        r"    draw=#8,",
        r"    fill=white",
        r"  ] coordinates {(#1,#7)};",
        r"}",
        "",
        r"\begin{tikzpicture}",
        r"\begin{axis}[",
        r"  width=0.98\linewidth,",
        r"  height=0.48\linewidth,",
        r"  xmin=-0.48,xmax=3.48,",
        r"  ymin=0,ymax=105,",
        r"  ylabel={Score (0--100)},",
        r"  label style={font=\normalsize},",
        r"  tick label style={font=\normalsize},",
        r"  xtick={0,1,2,3},",
        r"  xticklabels={",
        r"    {Planted\\error},",
        r"    {Unstated\\rationale},",
        r"    {Background\\knowledge},",
        r"    {Failure\\mode}",
        r"  },",
        r"  xticklabel style={align=center},",
        r"  ytick={0,20,40,60,80,100},",
        r"  tick align=outside,",
        r"  axis lines*=left,",
        r"  ymajorgrids,",
        r"  grid style={draw=gray!25,line width=0.4pt},",
        r"  clip=false,",
        r"  legend style={",
        r"    at={(0.5,0)},",
        r"    anchor=north,",
        r"    yshift=-3.2em,",
        r"    draw=none,",
        r"    font=\normalsize,",
        r"    legend columns=3,",
        r"    /tikz/every even column/.append style={column sep=0.8em}",
        r"  },",
        r"]",
    ]

    offsets = {"in_field": -0.18, "out_field": 0.18}
    group_counts: dict[str, list[int]] = {group: [] for group in H2_GROUPS}
    for target_index, target in enumerate(TARGET_ORDER):
        lines.extend(["", f"% {target}"])
        for group in H2_GROUPS:
            values = frame.loc[
                frame["question_target"].eq(target)
                & frame["group"].eq(group),
                "score_analysis",
            ].to_numpy(dtype=float)
            stats = _box_statistics(values)
            if stats is None:
                continue
            group_counts[group].append(len(values))
            position = target_index + offsets[group]
            color = TIKZ_COLORS[group]
            pattern = GROUP_PATTERNS[group]
            lines.extend(
                [
                    (
                        rf"\fieldBox{{{position:.2f}}}{{{stats['q1']:.8g}}}"
                        rf"{{{stats['q3']:.8g}}}{{{stats['median']:.8g}}}"
                        rf"{{{stats['lower']:.8g}}}{{{stats['upper']:.8g}}}"
                        rf"{{{stats['mean']:.8g}}}"
                    ),
                    rf"  {{{color}}}{{{pattern}}}",
                ]
            )
            outliers = stats["outliers"]
            if len(outliers):
                coordinates = " ".join(
                    f"({position:.2f},{float(value):.8g})"
                    for value in outliers
                )
                lines.extend(
                    [
                        r"\addplot[",
                        r"  forget plot,only marks,mark=*,",
                        r"  mark size=1.5pt,",
                        (
                            rf"  draw={color},fill={color},fill opacity=0.5"
                        ),
                        rf"] coordinates {{{coordinates}}};",
                    ]
                )

    lines.extend(["", "% Legend: sample size applies to each box."])
    for group in H2_GROUPS:
        color = TIKZ_COLORS[group]
        pattern = GROUP_PATTERNS[group]
        observed_counts = sorted(set(group_counts[group]))
        n_label = (
            str(observed_counts[0])
            if len(observed_counts) == 1
            else "varies"
        )
        lines.extend(
            [
                r"\addlegendimage{",
                r"  legend image code/.code={",
                (
                    rf"    \draw[draw={color},fill={color}!12,"
                    rf"pattern={pattern},pattern color={color}] "
                ),
                r"      (0cm,-0.09cm) rectangle (0.34cm,0.09cm);",
                r"  }",
                r"}",
                (
                    rf"\addlegendentry{{{_latex_escape(GROUP_LABELS[group])} "
                    rf"($n={n_label}$)}}"
                ),
            ]
        )
    lines.extend(
        [
            r"\addlegendimage{",
            r"  only marks,mark=diamond*,mark size=2.8pt,",
            r"  draw=black,fill=white",
            r"}",
            r"\addlegendentry{Mean}",
            "",
            r"\end{axis}",
            r"\end{tikzpicture}",
            rf"\Description{{{_latex_escape(description)}}}",
            r"\ifdefined\tikzexternalenable\tikzexternalenable\fi",
            r"\endgroup",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def write_all_plots(path: Path) -> None:
    text = "\n".join(
        [
            "% Native TikZ/PGFPlots snippets generated by plot_hypothesis_descriptives.py.",
            "% Preamble requirements:",
            "% \\usepackage{tikz}",
            "% \\usepackage{pgfplots}",
            "% \\usetikzlibrary{patterns}",
            "% \\pgfplotsset{compat=1.18}",
            "% acmart provides \\Description.",
            "% For non-acmart classes, a safe no-op fallback is:",
            "% \\providecommand{\\Description}[1]{}",
            "% Paths below assume the main document is compiled from the output root.",
            r"\input{latex/h1_score_distribution.tex}",
            r"\input{latex/h2_field_score_distribution.tex}",
            r"\input{latex/h1_answered_only_score_distribution.tex}",
            "",
        ]
    )
    path.write_text(text, encoding="utf-8")


def run(analysis_dir: Path, output_dir: Path) -> None:
    analysis_dir = analysis_dir.resolve()
    output_dir = output_dir.resolve()
    data, h1, h2_p, answered, answered_h1, paths = load_and_validate_inputs(
        analysis_dir
    )
    h1_frame, h2_frame, answered_frame, summary = (
        build_plot_frames_and_summary(
            data, h1, h2_p, answered, answered_h1
        )
    )
    descriptions = build_descriptions(summary, h2_p)
    h1_p = h1.set_index("question_target")["p.value.holm"].to_dict()
    answered_h1_p = (
        answered_h1.set_index("question_target")["p.value.holm"].to_dict()
    )

    png_dir = output_dir / "png"
    latex_dir = output_dir / "latex"
    png_dir.mkdir(parents=True, exist_ok=True)
    latex_dir.mkdir(exist_ok=True)

    figures = (
        (
            "h1_score_distribution.png",
            make_h1_figure(h1_frame, h1_p),
        ),
        (
            "h2_field_score_distribution.png",
            make_h2_figure(h2_frame, h2_p),
        ),
        (
            "h1_answered_only_score_distribution.png",
            make_h1_figure(
                answered_frame,
                answered_h1_p,
                "H1 sensitivity: Answered questions only",
            ),
        ),
    )
    for filename, figure in figures:
        details = descriptions[filename]
        figure.savefig(
            png_dir / filename,
            dpi=240,
            bbox_inches="tight",
            facecolor="white",
            metadata={
                "Title": details["title"],
                "Description": details["description"],
            },
        )
        plt.close(figure)

    pd.DataFrame(
        [
            {
                "filename": f"png/{filename}",
                "title": details["title"],
                "description": details["description"],
            }
            for filename, details in descriptions.items()
        ],
        columns=["filename", "title", "description"],
    ).to_csv(output_dir / "plot_descriptions.csv", index=False)
    summary.to_csv(output_dir / "plotted_summary.csv", index=False)

    write_h1_tikz_plot(
        latex_dir / "h1_score_distribution.tex",
        h1_frame,
        descriptions["h1_score_distribution.png"]["description"],
        h1_p,
    )
    write_h2_tikz_plot(
        latex_dir / "h2_field_score_distribution.tex",
        h2_frame,
        descriptions["h2_field_score_distribution.png"]["description"],
    )
    write_h1_tikz_plot(
        latex_dir / "h1_answered_only_score_distribution.tex",
        answered_frame,
        descriptions["h1_answered_only_score_distribution.png"]["description"],
        answered_h1_p,
        answered_only=True,
    )
    write_all_plots(latex_dir / "all_plots.tex")

    plotted = data["score_analysis"].notna()
    output_files = [
        "png/h1_score_distribution.png",
        "png/h2_field_score_distribution.png",
        "png/h1_answered_only_score_distribution.png",
        "latex/h1_score_distribution.tex",
        "latex/h2_field_score_distribution.tex",
        "latex/h1_answered_only_score_distribution.tex",
        "latex/all_plots.tex",
        "plot_descriptions.csv",
        "plotted_summary.csv",
        "analysis_metadata.json",
    ]
    metadata = {
        "source_paths": {name: str(path.resolve()) for name, path in paths.items()},
        "output_root": str(output_dir),
        "output_files": output_files,
        "score_semantics": {
            "primary_H1_and_H2": (
                "Question-level score_analysis on the 0-100 scale. Skips and "
                "timeouts are scored zero; only missing score_analysis is excluded "
                "from plotting and n."
            ),
            "answered_only_H1": (
                "Question-level score_analysis on the 0-100 scale after the R "
                "sensitivity analysis excludes skipped, timed-out, and "
                "unknown-response-status rows. Remaining missing score_analysis "
                "values are also excluded from plotting and n."
            ),
        },
        "p_value_semantics": {
            "H1": (
                "Per-target own-versus-foreign p.value.holm values from "
                "h1_primary_contrasts.csv; Holm-adjusted across target contrasts."
            ),
            "H2": (
                "One overall adjusted-model in-field-versus-out-of-field p.value from "
                "h2_primary_contrast.csv; no target-specific tests and no "
                "multiple-comparison correction."
            ),
            "H1_answered_only": (
                "Per-target own-versus-foreign p.value.holm values from "
                "sensitivity_answered_h1_contrasts.csv; Holm-adjusted across "
                "the four answered-only target contrasts."
            ),
        },
        "counts": {
            "cleaned_question_rows": int(len(data)),
            "rows_missing_score_analysis": int((~plotted).sum()),
            "h1_plotted_question_rows": int(plotted.sum()),
            "h1_unique_participants": int(
                data.loc[plotted, "participant_id"].nunique()
            ),
            "h2_foreign_plotted_question_rows": int(len(h2_frame)),
            "h2_unique_participants": int(h2_frame["participant_id"].nunique()),
            "h1_answered_only_plotted_question_rows": int(len(answered_frame)),
            "h1_answered_only_unique_participants": int(
                answered_frame["participant_id"].nunique()
            ),
        },
        "target_order": list(TARGET_ORDER),
        "h1_group_order": list(H1_GROUPS),
        "h2_group_order": list(H2_GROUPS),
    }
    (output_dir / "analysis_metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Create native PNG and TikZ/PGFPlots H1/H2 descriptive score "
            "distributions from analyze_final_ordbeta.R outputs."
        )
    )
    parser.add_argument(
        "--analysis-dir",
        type=Path,
        default=Path("final_ordbeta_output"),
        help="Directory containing analyze_final_ordbeta.R outputs.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("hypothesis_plot_outputs"),
        help="Output root for generated PNG, LaTeX, and summary files.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        run(args.analysis_dir, args.output_dir)
    except (FileNotFoundError, FileExistsError, OSError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
