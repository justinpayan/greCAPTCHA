"""Create privacy-preserving descriptive distributions from question-level data."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any, Iterable

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from analyze_tests import (
    FREE_RESPONSE_TARGETS,
    TARGET_LABELS,
    load_question_data,
    preprocess_tests,
)


LOGGER = logging.getLogger("descriptive_statistics")

SETTING_ORDER = ("own", "in_field_unfamiliar", "out_field_unfamiliar")
SETTING_LABELS = {
    "own": "Own paper",
    "in_field_unfamiliar": "In-field unfamiliar",
    "out_field_unfamiliar": "Out-field unfamiliar",
}
SETTING_COLORS = {
    "own": "#0072B2",
    "in_field_unfamiliar": "#E69F00",
    "out_field_unfamiliar": "#009E73",
}
SETTING_HATCHES = {
    "own": "///",
    "in_field_unfamiliar": r"\\\\",
    "out_field_unfamiliar": "xx",
}
SETTING_TIKZ_PATTERNS = {
    "own": "north east lines",
    "in_field_unfamiliar": "north west lines",
    "out_field_unfamiliar": "crosshatch",
}
TARGET_ORDER = tuple(TARGET_LABELS)
FREE_RESPONSE_ORDER = tuple(FREE_RESPONSE_TARGETS)

SUMMARY_COLUMNS = [
    "analysis_level",
    "metric",
    "observation_unit",
    "setting",
    "question_target",
    "n",
    "mean",
    "std",
    "median",
    "q1",
    "q3",
    "min",
    "max",
]

METRIC_CONFIG = {
    "score": {
        "targets": TARGET_ORDER,
        "title": "Score distribution",
        "ylabel": "Score (0–100)",
        "filename": "score_distribution",
        "limits": (0.0, 100.0),
        "discrete": False,
    },
    "duration_seconds": {
        "targets": TARGET_ORDER,
        "title": "Time taken by paper setting",
        "ylabel": "Duration (seconds)",
        "filename": "duration_distribution",
        "limits": None,
        "discrete": False,
    },
    "skipped_duration_seconds": {
        "targets": TARGET_ORDER,
        "title": "Time spent on skipped questions by paper setting",
        "ylabel": "Duration before skipping (seconds)",
        "filename": "skipped_duration_distribution",
        "limits": None,
        "discrete": False,
    },
    "skipped": {
        "targets": TARGET_ORDER,
        "title": "Percentage of questions skipped",
        "ylabel": "Questions skipped (%)",
        "filename": "skipped_percentage",
        "limits": (0.0, 100.0),
        "discrete": False,
    },
    "response_length": {
        "targets": FREE_RESPONSE_ORDER,
        "title": "Response length by paper setting",
        "ylabel": "Response length (characters)",
        "filename": "response_length_distribution",
        "limits": None,
        "discrete": False,
    },
}


def _validate_timeout_suffix(question_data: pd.DataFrame) -> None:
    """Require timed-out rows, if present, to form a suffix of each test."""
    for key, group in question_data.groupby(
        ["participant_id", "paper_position"], sort=False
    ):
        ordered = group.sort_values("position", kind="stable")
        flags = ordered["timed_out"].to_numpy(dtype=bool)
        if flags.any():
            first = int(np.flatnonzero(flags)[0])
            if not flags[first:].all():
                raise ValueError(
                    f"Test {key} has non-monotonic timed_out values; timed-out "
                    "positions must continue through position 8."
                )


def prepare_question_data(question_data: pd.DataFrame) -> pd.DataFrame:
    """Validate tests and attach paper-setting labels to each question row."""
    tests = preprocess_tests(question_data)
    _validate_timeout_suffix(question_data)

    metadata = tests[
        ["participant_id", "paper_position", "paper_type", "field_type"]
    ].copy()
    metadata["setting"] = np.where(
        metadata["paper_type"].eq("own"),
        "own",
        metadata["field_type"].map(
            {
                "in_field": "in_field_unfamiliar",
                "out_field": "out_field_unfamiliar",
            }
        ),
    )
    if metadata["setting"].isna().any():
        raise ValueError("Could not derive a descriptive setting for every test.")

    prepared = question_data.merge(
        metadata[
            ["participant_id", "paper_position", "paper_type", "setting"]
        ],
        on=["participant_id", "paper_position"],
        how="left",
        validate="many_to_one",
    )
    if prepared["setting"].isna().any():
        raise ValueError("Some question rows could not be matched to test metadata.")
    prepared["duration_seconds"] = prepared["duration_ms"] / 1000.0
    prepared["response_length"] = prepared["response"].astype(str).str.len()
    prepared["skipped_value"] = prepared["skipped"].astype(int)
    return prepared


def build_macro_frames(prepared: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Build one-observation-per-test frames for each descriptive metric."""
    keys = [
        "participant_id",
        "paper_position",
        "setting",
        "question_target",
    ]
    eligible = prepared.loc[~(prepared["skipped"] | prepared["timed_out"])].copy()

    frames: dict[str, pd.DataFrame] = {}
    for metric, source in (
        ("score", "score"),
        ("duration_seconds", "duration_seconds"),
    ):
        frame = (
            eligible.groupby(keys, sort=True, observed=True)[source]
            .mean()
            .rename("value")
            .reset_index()
        )
        frame["metric"] = metric
        frames[metric] = frame

    skipped_questions = prepared.loc[prepared["skipped"]]
    skipped_duration_frame = (
        skipped_questions.groupby(keys, sort=True, observed=True)["duration_seconds"]
        .mean()
        .rename("value")
        .reset_index()
    )
    skipped_duration_frame["metric"] = "skipped_duration_seconds"
    frames["skipped_duration_seconds"] = skipped_duration_frame

    response = eligible.loc[
        eligible["question_target"].isin(FREE_RESPONSE_ORDER)
    ]
    response_frame = (
        response.groupby(keys, sort=True, observed=True)["response_length"]
        .mean()
        .rename("value")
        .reset_index()
    )
    response_frame["metric"] = "response_length"
    frames["response_length"] = response_frame

    skipped_frame = (
        prepared.groupby(keys, sort=True, observed=True)
        .agg(value=("skipped_value", "sum"), total_count=("skipped_value", "size"))
        .reset_index()
    )
    skipped_frame["metric"] = "skipped"
    frames["skipped"] = skipped_frame
    return frames


def build_micro_frames(prepared: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Build pooled question-row frames for each descriptive metric."""
    columns = [
        "participant_id",
        "paper_position",
        "setting",
        "question_target",
    ]
    eligible = prepared.loc[~(prepared["skipped"] | prepared["timed_out"])].copy()

    frames: dict[str, pd.DataFrame] = {}
    for metric, source in (
        ("score", "score"),
        ("duration_seconds", "duration_seconds"),
    ):
        frame = eligible[columns].copy()
        frame["value"] = eligible[source].to_numpy()
        frame["metric"] = metric
        frames[metric] = frame

    skipped_questions = prepared.loc[prepared["skipped"]]
    skipped_duration_frame = skipped_questions[columns].copy()
    skipped_duration_frame["value"] = skipped_questions[
        "duration_seconds"
    ].to_numpy()
    skipped_duration_frame["metric"] = "skipped_duration_seconds"
    frames["skipped_duration_seconds"] = skipped_duration_frame

    response = eligible.loc[
        eligible["question_target"].isin(FREE_RESPONSE_ORDER)
    ]
    response_frame = response[columns].copy()
    response_frame["value"] = response["response_length"].to_numpy()
    response_frame["metric"] = "response_length"
    frames["response_length"] = response_frame

    skipped_frame = prepared[columns].copy()
    skipped_frame["value"] = prepared["skipped_value"].to_numpy()
    skipped_frame["total_count"] = 1
    skipped_frame["metric"] = "skipped"
    frames["skipped"] = skipped_frame
    return frames


def build_timeout_frame(prepared: pd.DataFrame) -> pd.DataFrame:
    """Return first timed-out position, or 9 for completion, for every test."""
    records: list[dict[str, Any]] = []
    for key, group in prepared.groupby(
        ["participant_id", "paper_position"], sort=True
    ):
        settings = group["setting"].drop_duplicates()
        if len(settings) != 1:
            raise ValueError(f"Test {key} has inconsistent descriptive settings.")
        timed_out_positions = group.loc[group["timed_out"], "position"]
        records.append(
            {
                "participant_id": key[0],
                "paper_position": int(key[1]),
                "setting": settings.iloc[0],
                "value": (
                    int(timed_out_positions.min())
                    if not timed_out_positions.empty
                    else 9
                ),
                "metric": "first_timed_out_position",
            }
        )
    return pd.DataFrame.from_records(records)


def _descriptive_values(values: pd.Series) -> dict[str, Any]:
    numeric = pd.to_numeric(values, errors="coerce").dropna()
    if numeric.empty:
        return {
            "n": 0,
            "mean": np.nan,
            "std": np.nan,
            "median": np.nan,
            "q1": np.nan,
            "q3": np.nan,
            "min": np.nan,
            "max": np.nan,
        }
    return {
        "n": int(len(numeric)),
        "mean": float(numeric.mean()),
        "std": float(numeric.std(ddof=1)) if len(numeric) > 1 else np.nan,
        "median": float(numeric.median()),
        "q1": float(numeric.quantile(0.25)),
        "q3": float(numeric.quantile(0.75)),
        "min": float(numeric.min()),
        "max": float(numeric.max()),
    }


def summarize_metric(
    frame: pd.DataFrame,
    analysis_level: str,
    metric: str,
    targets: Iterable[str],
) -> pd.DataFrame:
    """Summarize every expected setting-target combination, including empties."""
    unit = "tests" if analysis_level == "macro_averaged" else "question_rows"
    rows: list[dict[str, Any]] = []
    for target in targets:
        for setting in SETTING_ORDER:
            values = frame.loc[
                frame["question_target"].eq(target)
                & frame["setting"].eq(setting),
                "value",
            ]
            stats = _descriptive_values(values)
            if stats["n"] == 0:
                LOGGER.warning(
                    "No %s observations for %s / %s / %s / %s.",
                    unit,
                    analysis_level,
                    metric,
                    target,
                    setting,
                )
            rows.append(
                {
                    "analysis_level": analysis_level,
                    "metric": metric,
                    "observation_unit": unit,
                    "setting": setting,
                    "question_target": target,
                    **stats,
                }
            )
    return pd.DataFrame(rows, columns=SUMMARY_COLUMNS)


def summarize_skipped_percentages(
    frame: pd.DataFrame, analysis_level: str
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Calculate 100 times skipped questions divided by total questions."""
    detail_rows: list[dict[str, Any]] = []
    summary_rows: list[dict[str, Any]] = []
    for target in TARGET_ORDER:
        for setting in SETTING_ORDER:
            group = frame.loc[
                frame["question_target"].eq(target)
                & frame["setting"].eq(setting)
            ]
            n_skipped = int(group["value"].sum())
            n_total = int(group["total_count"].sum())
            percentage = (
                100.0 * n_skipped / n_total if n_total else np.nan
            )
            if not n_total:
                LOGGER.warning(
                    "No questions available for skipped percentage / %s / %s.",
                    target,
                    setting,
                )
            detail_rows.append(
                {
                    "analysis_level": analysis_level,
                    "setting": setting,
                    "question_target": target,
                    "n_skipped": n_skipped,
                    "n_total": n_total,
                    "percentage_skipped": percentage,
                }
            )
            summary_rows.append(
                {
                    "analysis_level": analysis_level,
                    "metric": "skipped_percentage",
                    "observation_unit": "question_rows",
                    "setting": setting,
                    "question_target": target,
                    "n": n_total,
                    "mean": percentage,
                    "std": np.nan,
                    "median": np.nan,
                    "q1": np.nan,
                    "q3": np.nan,
                    "min": np.nan,
                    "max": np.nan,
                }
            )
    return (
        pd.DataFrame(detail_rows),
        pd.DataFrame(summary_rows, columns=SUMMARY_COLUMNS),
    )


def summarize_timeout(
    frame: pd.DataFrame, analysis_level: str
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Summarize timeout progress and return its setting-by-position frequencies."""
    summary_rows: list[dict[str, Any]] = []
    frequency_rows: list[dict[str, Any]] = []
    for setting in SETTING_ORDER:
        values = frame.loc[frame["setting"].eq(setting), "value"]
        stats = _descriptive_values(values)
        if stats["n"] == 0:
            LOGGER.warning("No tests available for timeout setting %s.", setting)
        summary_rows.append(
            {
                "analysis_level": analysis_level,
                "metric": "first_timed_out_position",
                "observation_unit": "tests",
                "setting": setting,
                "question_target": "",
                **stats,
            }
        )
        counts = values.value_counts().to_dict()
        for position in range(1, 10):
            frequency_rows.append(
                {
                    "analysis_level": analysis_level,
                    "setting": setting,
                    "first_timed_out_position": position,
                    "position_label": (
                        "Completed" if position == 9 else str(position)
                    ),
                    "count": int(counts.get(position, 0)),
                }
            )
    return (
        pd.DataFrame(summary_rows, columns=SUMMARY_COLUMNS),
        pd.DataFrame(frequency_rows),
    )


def _draw_distribution(
    ax: plt.Axes,
    values: np.ndarray,
    x_position: float,
    color: str,
    hatch: str,
    width: float,
    discrete: bool,
    rng: np.random.Generator,
) -> None:
    """Draw a Tukey box plot with a mean marker and optional raw points."""
    values = values[np.isfinite(values)]
    if len(values):
        ax.boxplot(
            [values],
            positions=[x_position],
            widths=width,
            patch_artist=True,
            showmeans=True,
            whis=1.5,
            boxprops={
                "facecolor": color,
                "edgecolor": color,
                "alpha": 0.45,
                "linewidth": 0.9,
                "hatch": hatch,
            },
            medianprops={"color": "black", "linewidth": 1.4},
            whiskerprops={"color": color, "linewidth": 1.0},
            capprops={"color": color, "linewidth": 1.0},
            flierprops={
                "marker": "o",
                "markersize": 3,
                "markerfacecolor": color,
                "markeredgecolor": color,
                "alpha": 0.45,
            },
            meanprops={
                "marker": "D",
                "markersize": 4.5,
                "markerfacecolor": "white",
                "markeredgecolor": color,
                "markeredgewidth": 1.0,
            },
        )
        if discrete:
            jitter = rng.uniform(-width * 0.25, width * 0.25, size=len(values))
            ax.scatter(
                x_position + jitter,
                values,
                s=10,
                facecolor=color,
                edgecolor="none",
                alpha=0.28,
                zorder=3,
            )


def _style_axis(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#D9D9D9", linewidth=0.6, alpha=0.8)
    ax.set_axisbelow(True)


def _add_setting_legend(ax: plt.Axes, include_mean: bool = True) -> None:
    handles = [
        Patch(
            facecolor=SETTING_COLORS[setting],
            edgecolor=SETTING_COLORS[setting],
            alpha=0.45,
            hatch=SETTING_HATCHES[setting],
            label=SETTING_LABELS[setting],
        )
        for setting in SETTING_ORDER
    ]
    if include_mean:
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
        bbox_to_anchor=(0.5, -0.16),
        ncol=4,
        frameon=False,
    )


def _skipped_percentage_ymax(frame: pd.DataFrame) -> float:
    percentages: list[float] = []
    for target in TARGET_ORDER:
        for setting in SETTING_ORDER:
            group = frame.loc[
                frame["question_target"].eq(target)
                & frame["setting"].eq(setting)
            ]
            n_total = int(group["total_count"].sum())
            if n_total:
                percentages.append(100.0 * float(group["value"].sum()) / n_total)
    maximum = max(percentages, default=0.0)
    padded = maximum + max(5.0, maximum * 0.15)
    return max(5.0, 5.0 * float(np.ceil(padded / 5.0)))


def plot_skipped_percentage(frame: pd.DataFrame) -> plt.Figure:
    """Plot pooled skipped percentages as grouped bars."""
    fig, ax = plt.subplots(figsize=(12.0, 6.8))
    offsets = (-0.26, 0.0, 0.26)
    width = 0.22
    y_max = _skipped_percentage_ymax(frame)
    for target_index, target in enumerate(TARGET_ORDER):
        for setting_index, setting in enumerate(SETTING_ORDER):
            x_position = target_index + offsets[setting_index]
            group = frame.loc[
                frame["question_target"].eq(target)
                & frame["setting"].eq(setting)
            ]
            n_skipped = int(group["value"].sum())
            n_total = int(group["total_count"].sum())
            percentage = (
                100.0 * n_skipped / n_total if n_total else 0.0
            )
            ax.bar(
                x_position,
                percentage,
                width=width,
                color=SETTING_COLORS[setting],
                alpha=0.75,
                hatch=SETTING_HATCHES[setting],
                edgecolor=SETTING_COLORS[setting],
            )
            ax.text(
                x_position,
                1.01,
                f"n={n_total}",
                transform=ax.get_xaxis_transform(),
                ha="center",
                va="bottom",
                fontsize=7,
                color=SETTING_COLORS[setting],
                clip_on=False,
            )
    ax.set_title("Percentage of questions skipped", pad=26)
    ax.set_ylabel("Questions skipped (%)")
    ax.set_xticks(range(len(TARGET_ORDER)))
    ax.set_xticklabels([TARGET_LABELS[target] for target in TARGET_ORDER])
    ax.set_xlim(-0.6, len(TARGET_ORDER) - 0.4)
    ax.set_ylim(0, y_max)
    _style_axis(ax)
    _add_setting_legend(ax, include_mean=False)
    fig.tight_layout(rect=(0, 0.08, 1, 0.94))
    return fig


def _metric_limits(
    frame: pd.DataFrame, analysis_level: str, metric: str
) -> tuple[float, float]:
    configured = METRIC_CONFIG[metric]["limits"]
    if configured is not None:
        return float(configured[0]), float(configured[1])
    if metric == "skipped" and analysis_level == "micro_averaged":
        return -0.08, 1.08
    values = frame["value"].dropna()
    if values.empty:
        return 0.0, 1.0
    maximum = float(values.max())
    return 0.0, max(1.0, maximum * 1.08)


def plot_grouped_metric(
    frame: pd.DataFrame,
    analysis_level: str,
    metric: str,
) -> plt.Figure:
    """Create a grouped setting-by-target box-and-whisker figure."""
    if metric == "skipped":
        return plot_skipped_percentage(frame)
    config = METRIC_CONFIG[metric]
    targets = config["targets"]
    fig, ax = plt.subplots(figsize=(12.0, 6.8))
    offsets = (-0.26, 0.0, 0.26)
    width = 0.22
    rng = np.random.default_rng(2026)

    for target_index, target in enumerate(targets):
        for setting_index, setting in enumerate(SETTING_ORDER):
            x_position = target_index + offsets[setting_index]
            values = frame.loc[
                frame["question_target"].eq(target)
                & frame["setting"].eq(setting),
                "value",
            ].to_numpy(dtype=float)
            _draw_distribution(
                ax,
                values,
                x_position,
                SETTING_COLORS[setting],
                SETTING_HATCHES[setting],
                width,
                bool(config["discrete"]),
                rng,
            )
            ax.text(
                x_position,
                1.01,
                f"n={len(values)}",
                transform=ax.get_xaxis_transform(),
                ha="center",
                va="bottom",
                fontsize=7,
                color=SETTING_COLORS[setting],
                clip_on=False,
            )

    level_label = (
        "Macro-averaged (one observation per test)"
        if analysis_level == "macro_averaged"
        else "Micro-averaged (pooled question rows)"
    )
    title = (
        str(config["title"])
        if metric == "score"
        else f"{config['title']}\n{level_label}"
    )
    ax.set_title(title, pad=26)
    ax.set_ylabel(
        (
            "Skipped questions per test"
            if metric == "skipped" and analysis_level == "macro_averaged"
            else "Skipped indicator (0 = no, 1 = yes)"
            if metric == "skipped"
            else config["ylabel"]
        )
    )
    ax.set_xticks(range(len(targets)))
    ax.set_xticklabels([TARGET_LABELS[target] for target in targets])
    ax.set_xlim(-0.6, len(targets) - 0.4)
    ax.set_ylim(*_metric_limits(frame, analysis_level, metric))
    if metric == "skipped" and analysis_level == "micro_averaged":
        ax.set_yticks([0, 1])
    _style_axis(ax)
    _add_setting_legend(ax)
    fig.tight_layout(rect=(0, 0.08, 1, 0.94))
    return fig


def plot_timeout(frame: pd.DataFrame, analysis_level: str) -> plt.Figure:
    """Create the test-level first-timeout distribution figure."""
    fig, ax = plt.subplots(figsize=(9.0, 6.4))
    rng = np.random.default_rng(2026)
    for index, setting in enumerate(SETTING_ORDER):
        values = frame.loc[frame["setting"].eq(setting), "value"].to_numpy(
            dtype=float
        )
        _draw_distribution(
            ax,
            values,
            float(index),
            SETTING_COLORS[setting],
            SETTING_HATCHES[setting],
            0.55,
            True,
            rng,
        )
        ax.text(
            index,
            1.01,
            f"n={len(values)}",
            transform=ax.get_xaxis_transform(),
            ha="center",
            va="bottom",
            fontsize=8,
            color=SETTING_COLORS[setting],
            clip_on=False,
        )
    ax.set_title(
        "Test progress by paper setting\n"
        f"Test-level distribution (included in {analysis_level})",
        pad=26,
    )
    ax.set_ylabel("First timed-out question")
    ax.set_xticks(range(len(SETTING_ORDER)))
    ax.set_xticklabels([SETTING_LABELS[setting] for setting in SETTING_ORDER])
    ax.set_yticks(range(1, 10))
    ax.set_yticklabels([str(value) for value in range(1, 9)] + ["Completed"])
    ax.set_ylim(0.6, 9.4)
    ax.set_xlim(-0.6, len(SETTING_ORDER) - 0.4)
    _style_axis(ax)
    ax.legend(
        handles=[
            Line2D(
                [0],
                [0],
                marker="D",
                linestyle="none",
                markerfacecolor="white",
                markeredgecolor="#333333",
                markersize=5,
                label="Mean (Completed encoded as 9)",
            )
        ],
        loc="upper center",
        bbox_to_anchor=(0.5, -0.16),
        frameon=False,
    )
    fig.tight_layout(rect=(0, 0.08, 1, 0.94))
    return fig


def save_png(fig: plt.Figure, output_dir: Path, filename: str) -> None:
    """Save a quick-view PNG."""
    png_dir = output_dir / "png"
    png_dir.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        png_dir / f"{filename}.png",
        dpi=200,
        bbox_inches="tight",
        facecolor="white",
    )
    plt.close(fig)


def _latex_text(value: str) -> str:
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "–": "--",
    }
    return "".join(replacements.get(character, character) for character in value)


def _description_command(text: str) -> str:
    return rf"\Description{{{_latex_text(text)}}}"


def _grouped_plot_description(
    frame: pd.DataFrame, analysis_level: str, metric: str
) -> str:
    metric_labels = {
        "score": "question scores",
        "duration_seconds": "time spent on answered questions in seconds",
        "skipped_duration_seconds": "time spent before skipped questions in seconds",
        "response_length": "free-response lengths in characters",
    }
    targets = METRIC_CONFIG[metric]["targets"]
    target_names = ", ".join(TARGET_LABELS[target] for target in targets)
    unit = (
        "Each observation is a within-test average."
        if analysis_level == "macro_averaged"
        else "Each observation is an individual question response."
    )
    values = frame["value"].dropna()
    value_range = (
        f" Observed values range from {float(values.min()):.3g} "
        f"to {float(values.max()):.3g}."
        if not values.empty
        else " No observations are available."
    )
    return (
        f"Box-and-whisker chart of {metric_labels[metric]} for {target_names}. "
        "Each question type has boxes for own papers, in-field unfamiliar "
        "papers, and out-field unfamiliar papers. "
        f"{unit} Boxes show quartiles and medians, whiskers extend to 1.5 "
        "times the interquartile range, diamonds mark means, and text above "
        f"each box gives its sample size.{value_range}"
    )


def _coordinate(x_value: float, y_value: float) -> str:
    return f"({x_value:.8g},{y_value:.8g})"


def _tikz_distribution_lines(
    values: np.ndarray,
    x_position: float,
    color_name: str,
    pattern_name: str,
    width: float,
    discrete: bool,
    rng: np.random.Generator,
) -> list[str]:
    values = values[np.isfinite(values)]
    lines: list[str] = []
    if not len(values):
        return lines

    q1, median, q3 = np.quantile(values, [0.25, 0.5, 0.75])
    iqr = q3 - q1
    lower_candidates = values[values >= q1 - 1.5 * iqr]
    upper_candidates = values[values <= q3 + 1.5 * iqr]
    lower_whisker = float(lower_candidates.min())
    upper_whisker = float(upper_candidates.max())
    half_width = width / 2.0
    cap_half_width = width * 0.28
    lines.extend(
        [
            (
                rf"\draw[draw={color_name},fill={color_name}!12,"
                rf"pattern={pattern_name},pattern color={color_name},"
                rf"line width=0.6pt] "
                rf"(axis cs:{x_position - half_width:.8g},{q1:.8g}) rectangle "
                rf"(axis cs:{x_position + half_width:.8g},{q3:.8g});"
            ),
            (
                rf"\draw[draw={color_name},line width=0.7pt] "
                rf"(axis cs:{x_position:.8g},{lower_whisker:.8g}) -- "
                rf"(axis cs:{x_position:.8g},{q1:.8g});"
            ),
            (
                rf"\draw[draw={color_name},line width=0.7pt] "
                rf"(axis cs:{x_position:.8g},{q3:.8g}) -- "
                rf"(axis cs:{x_position:.8g},{upper_whisker:.8g});"
            ),
            (
                rf"\draw[draw={color_name},line width=0.7pt] "
                rf"(axis cs:{x_position - cap_half_width:.8g},{lower_whisker:.8g}) -- "
                rf"(axis cs:{x_position + cap_half_width:.8g},{lower_whisker:.8g});"
            ),
            (
                rf"\draw[draw={color_name},line width=0.7pt] "
                rf"(axis cs:{x_position - cap_half_width:.8g},{upper_whisker:.8g}) -- "
                rf"(axis cs:{x_position + cap_half_width:.8g},{upper_whisker:.8g});"
            ),
            (
                r"\draw[draw=black,line width=0.9pt] "
                rf"(axis cs:{x_position - half_width:.8g},{median:.8g}) -- "
                rf"(axis cs:{x_position + half_width:.8g},{median:.8g});"
            ),
        ]
    )
    lines.append(
        rf"\addplot[forget plot,only marks,mark=diamond*,mark size=2.4pt,draw={color_name},"
        rf"fill=white,line width=0.8pt] coordinates "
        rf"{{{_coordinate(x_position, float(np.mean(values)))}}};"
    )
    if discrete:
        jitter = rng.uniform(-width * 0.25, width * 0.25, size=len(values))
        points = " ".join(
            _coordinate(x_position + offset, value)
            for value, offset in zip(values, jitter, strict=True)
        )
        lines.append(
            rf"\addplot[forget plot,only marks,mark=*,mark size=1pt,draw=none,"
            rf"fill={color_name},fill opacity=0.28] coordinates {{{points}}};"
        )
    else:
        outliers = values[
            (values < lower_whisker) | (values > upper_whisker)
        ]
        if len(outliers):
            points = " ".join(
                _coordinate(x_position, value) for value in outliers
            )
            lines.append(
                rf"\addplot[forget plot,only marks,mark=*,mark size=1.2pt,draw={color_name},"
                rf"fill={color_name},fill opacity=0.45] coordinates {{{points}}};"
            )
    return lines


def _tikz_color_definitions() -> list[str]:
    names = {
        "own": "ownColor",
        "in_field_unfamiliar": "inFieldColor",
        "out_field_unfamiliar": "outFieldColor",
    }
    return [
        rf"\definecolor{{{names[setting]}}}{{HTML}}{{"
        f"{SETTING_COLORS[setting].lstrip('#')}}}"
        for setting in SETTING_ORDER
    ]


def _tikz_legend_lines(include_mean: bool = True) -> list[str]:
    lines = [
        r"\addlegendimage{legend image code/.code={\draw[draw=ownColor,fill=ownColor!12,pattern=north east lines,pattern color=ownColor] (0cm,-0.08cm) rectangle (0.34cm,0.08cm);}}",
        r"\addlegendentry{Own paper}",
        r"\addlegendimage{legend image code/.code={\draw[draw=inFieldColor,fill=inFieldColor!12,pattern=north west lines,pattern color=inFieldColor] (0cm,-0.08cm) rectangle (0.34cm,0.08cm);}}",
        r"\addlegendentry{In-field unfamiliar}",
        r"\addlegendimage{legend image code/.code={\draw[draw=outFieldColor,fill=outFieldColor!12,pattern=crosshatch,pattern color=outFieldColor] (0cm,-0.08cm) rectangle (0.34cm,0.08cm);}}",
        r"\addlegendentry{Out-field unfamiliar}",
    ]
    if include_mean:
        lines.extend(
            [
                r"\addlegendimage{legend image code/.code={\draw plot[only marks,mark=diamond*,mark size=2.4pt,draw=black,fill=white] coordinates {(0.17cm,0cm)};}}",
                r"\addlegendentry{Mean}",
            ]
        )
    return lines


def write_skipped_percentage_tikz(
    frame: pd.DataFrame,
    analysis_level: str,
    output_dir: Path,
    filename: str,
) -> None:
    """Construct the pooled skipped-percentage grouped bar chart."""
    offsets = (-0.26, 0.0, 0.26)
    color_names = ("ownColor", "inFieldColor", "outFieldColor")
    y_max = _skipped_percentage_ymax(frame)
    xticklabels = ",".join(
        "{" + _latex_text(TARGET_LABELS[target]) + "}"
        for target in TARGET_ORDER
    )
    lines = [
        r"\begin{tikzpicture}",
        *_tikz_color_definitions(),
        r"\begin{axis}[",
        r"width=0.98\linewidth,",
        r"height=0.60\linewidth,",
        r"xmin=-0.6,xmax=3.6,",
        f"ymin=0,ymax={y_max:.8g},",
        r"title={Percentage of questions skipped},",
        r"title style={align=center,yshift=2.2em},",
        r"ylabel={Questions skipped (\%)},",
        r"xtick={0,1,2,3},",
        f"xticklabels={{{xticklabels}}},",
        r"tick align=outside,",
        r"axis lines*=left,",
        r"ymajorgrids,",
        r"grid style={draw=gray!30,line width=0.4pt},",
        r"clip=false,",
        r"legend style={at={(0.5,-0.18)},anchor=north,draw=none,legend columns=3},",
        r"]",
    ]
    for target_index, target in enumerate(TARGET_ORDER):
        for setting_index, setting in enumerate(SETTING_ORDER):
            x_position = target_index + offsets[setting_index]
            group = frame.loc[
                frame["question_target"].eq(target)
                & frame["setting"].eq(setting)
            ]
            n_skipped = int(group["value"].sum())
            n_total = int(group["total_count"].sum())
            percentage = (
                100.0 * n_skipped / n_total if n_total else 0.0
            )
            lines.append(
                rf"\addplot[forget plot,ybar,bar width=10pt,draw={color_names[setting_index]},"
                rf"fill={color_names[setting_index]}!12,"
                rf"pattern={SETTING_TIKZ_PATTERNS[setting]},"
                rf"pattern color={color_names[setting_index]}] coordinates "
                rf"{{{_coordinate(x_position, percentage)}}};"
            )
            normalized_x = (x_position + 0.6) / 4.2
            lines.append(
                rf"\node[anchor=south,font=\scriptsize,"
                rf"text={color_names[setting_index]}] at "
                rf"(rel axis cs:{normalized_x:.8g},1.01) "
                rf"{{{{n={n_total}}}}};"
            )
    lines.extend(
        [
            *_tikz_legend_lines(include_mean=False),
            r"\end{axis}",
            r"\end{tikzpicture}",
            _description_command(
                "Grouped bar chart of the percentage of questions skipped for "
                "Planted error, Unstated rationale, Background knowledge, and "
                "Failure mode questions. Each question type has bars for own "
                "papers, in-field unfamiliar papers, and out-field unfamiliar "
                "papers. Bar height is 100 times skipped questions divided by "
                "total questions, and text above each bar gives the denominator. "
                f"The same pooled chart is included in the {analysis_level} output."
            ),
            "",
        ]
    )
    tikz_dir = output_dir / "tikz"
    tikz_dir.mkdir(parents=True, exist_ok=True)
    (tikz_dir / f"{filename}.tex").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def write_grouped_tikz(
    frame: pd.DataFrame,
    analysis_level: str,
    metric: str,
    output_dir: Path,
    filename: str,
) -> None:
    """Construct grouped box plots directly as native TikZ/PGFPlots."""
    if metric == "skipped":
        write_skipped_percentage_tikz(
            frame, analysis_level, output_dir, filename
        )
        return
    config = METRIC_CONFIG[metric]
    targets = config["targets"]
    offsets = (-0.26, 0.0, 0.26)
    width = 0.22
    x_min, x_max = -0.6, len(targets) - 0.4
    y_min, y_max = _metric_limits(frame, analysis_level, metric)
    level_label = (
        "Macro-averaged (one observation per test)"
        if analysis_level == "macro_averaged"
        else "Micro-averaged (pooled question rows)"
    )
    title_text = (
        _latex_text(str(config["title"]))
        if metric == "score"
        else (
            _latex_text(str(config["title"]))
            + r"\\"
            + _latex_text(level_label)
        )
    )
    ylabel = (
        "Skipped questions per test"
        if metric == "skipped" and analysis_level == "macro_averaged"
        else "Skipped indicator (0 = no, 1 = yes)"
        if metric == "skipped"
        else str(config["ylabel"])
    )
    xticks = ",".join(str(index) for index in range(len(targets)))
    xticklabels = ",".join(
        "{" + _latex_text(TARGET_LABELS[target]) + "}" for target in targets
    )
    lines = [
        r"\begin{tikzpicture}",
        *_tikz_color_definitions(),
        r"\begin{axis}[",
        r"width=0.98\linewidth,",
        r"height=0.60\linewidth,",
        f"xmin={x_min},xmax={x_max},",
        f"ymin={y_min:.8g},ymax={y_max:.8g},",
        f"title={{{title_text}}},",
        r"title style={align=center,yshift=2.2em},",
        f"ylabel={{{_latex_text(ylabel)}}},",
        f"xtick={{{xticks}}},",
        f"xticklabels={{{xticklabels}}},",
        r"tick align=outside,",
        r"axis lines*=left,",
        r"ymajorgrids,",
        r"grid style={draw=gray!30,line width=0.4pt},",
        r"clip=false,",
        r"legend style={at={(0.5,-0.18)},anchor=north,draw=none,legend columns=4},",
        r"]",
    ]
    if metric == "skipped" and analysis_level == "micro_averaged":
        lines.insert(-1, r"ytick={0,1},")

    rng = np.random.default_rng(2026)
    color_names = ("ownColor", "inFieldColor", "outFieldColor")
    for target_index, target in enumerate(targets):
        for setting_index, setting in enumerate(SETTING_ORDER):
            x_position = target_index + offsets[setting_index]
            values = frame.loc[
                frame["question_target"].eq(target)
                & frame["setting"].eq(setting),
                "value",
            ].to_numpy(dtype=float)
            lines.extend(
                _tikz_distribution_lines(
                    values,
                    x_position,
                    color_names[setting_index],
                    SETTING_TIKZ_PATTERNS[setting],
                    width,
                    bool(config["discrete"]),
                    rng,
                )
            )
            normalized_x = (x_position - x_min) / (x_max - x_min)
            lines.append(
                rf"\node[anchor=south,font=\scriptsize,"
                rf"text={color_names[setting_index]}] at "
                rf"(rel axis cs:{normalized_x:.8g},1.01) {{{{n={len(values)}}}}};"
            )
    lines.extend(
        [
            *_tikz_legend_lines(),
            r"\end{axis}",
            r"\end{tikzpicture}",
            _description_command(
                _grouped_plot_description(frame, analysis_level, metric)
            ),
            "",
        ]
    )
    tikz_dir = output_dir / "tikz"
    tikz_dir.mkdir(parents=True, exist_ok=True)
    (tikz_dir / f"{filename}.tex").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def write_timeout_tikz(
    frame: pd.DataFrame,
    analysis_level: str,
    output_dir: Path,
    filename: str,
) -> None:
    """Construct the discrete timeout box plot directly as TikZ/PGFPlots."""
    x_min, x_max = -0.6, len(SETTING_ORDER) - 0.4
    xticklabels = ",".join(
        "{" + _latex_text(SETTING_LABELS[setting]) + "}"
        for setting in SETTING_ORDER
    )
    lines = [
        r"\begin{tikzpicture}",
        *_tikz_color_definitions(),
        r"\begin{axis}[",
        r"width=0.98\linewidth,",
        r"height=0.60\linewidth,",
        f"xmin={x_min},xmax={x_max},",
        r"ymin=0.6,ymax=9.4,",
        (
            r"title={Test progress by paper setting\\Test-level distribution "
            + f"(included in {_latex_text(analysis_level)})"
            + "},"
        ),
        r"title style={align=center,yshift=2.2em},",
        r"ylabel={First timed-out question},",
        r"xtick={0,1,2},",
        f"xticklabels={{{xticklabels}}},",
        r"ytick={1,2,3,4,5,6,7,8,9},",
        r"yticklabels={{1},{2},{3},{4},{5},{6},{7},{8},{Completed}},",
        r"tick align=outside,",
        r"axis lines*=left,",
        r"ymajorgrids,",
        r"grid style={draw=gray!30,line width=0.4pt},",
        r"clip=false,",
        r"legend style={at={(0.5,-0.18)},anchor=north,draw=none},",
        r"]",
    ]
    rng = np.random.default_rng(2026)
    color_names = ("ownColor", "inFieldColor", "outFieldColor")
    for index, setting in enumerate(SETTING_ORDER):
        values = frame.loc[frame["setting"].eq(setting), "value"].to_numpy(
            dtype=float
        )
        lines.extend(
            _tikz_distribution_lines(
                values,
                float(index),
                color_names[index],
                SETTING_TIKZ_PATTERNS[setting],
                0.55,
                True,
                rng,
            )
        )
        normalized_x = (index - x_min) / (x_max - x_min)
        lines.append(
            rf"\node[anchor=south,font=\scriptsize,text={color_names[index]}] "
            rf"at (rel axis cs:{normalized_x:.8g},1.01) {{{{n={len(values)}}}}};"
        )
    lines.extend(
        [
            r"\addlegendimage{only marks,mark=diamond*,mark size=2.4pt,draw=black,fill=white}",
            r"\addlegendentry{Mean (Completed encoded as 9)}",
            r"\end{axis}",
            r"\end{tikzpicture}",
            _description_command(
                "Three box-and-whisker plots show the first timed-out question "
                "position for own papers, in-field unfamiliar papers, and "
                "out-field unfamiliar papers. Positions range from 1 through "
                "8; Completed is encoded as 9. Boxes show quartiles and medians, "
                "whiskers extend to 1.5 times the interquartile range, diamonds "
                "mark means, individual observations are overlaid, and text "
                "above each box gives its number of tests."
            ),
            "",
        ]
    )
    tikz_dir = output_dir / "tikz"
    tikz_dir.mkdir(parents=True, exist_ok=True)
    (tikz_dir / f"{filename}.tex").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def write_analysis_level(
    level: str,
    frames: dict[str, pd.DataFrame],
    timeout_frame: pd.DataFrame,
    output_dir: Path,
) -> None:
    """Write summaries and all plots for one averaging level."""
    level_dir = output_dir / level
    level_dir.mkdir(parents=True, exist_ok=True)
    summaries = [
        summarize_metric(frames[metric], level, metric, config["targets"])
        for metric, config in METRIC_CONFIG.items()
        if metric != "skipped"
    ]
    skipped_percentages, skipped_summary = summarize_skipped_percentages(
        frames["skipped"], level
    )
    timeout_summary, timeout_frequencies = summarize_timeout(timeout_frame, level)
    pd.concat(
        [*summaries, skipped_summary, timeout_summary], ignore_index=True
    ).to_csv(
        level_dir / "descriptive_summary.csv", index=False
    )
    skipped_percentages.to_csv(
        level_dir / "skipped_percentages.csv", index=False
    )
    timeout_frequencies.to_csv(
        level_dir / "timeout_position_frequencies.csv", index=False
    )

    for metric, config in METRIC_CONFIG.items():
        figure = plot_grouped_metric(frames[metric], level, metric)
        filename = str(config["filename"])
        save_png(figure, level_dir, filename)
        write_grouped_tikz(
            frames[metric], level, metric, level_dir, filename
        )
    timeout_filename = "first_timed_out_position_distribution"
    save_png(
        plot_timeout(timeout_frame, level),
        level_dir,
        timeout_filename,
    )
    write_timeout_tikz(timeout_frame, level, level_dir, timeout_filename)


def run_descriptive_analysis(input_path: Path, output_dir: Path) -> None:
    """Load private input and write only aggregate tables and plot artifacts."""
    question_data = load_question_data(input_path)
    prepared = prepare_question_data(question_data)
    macro_frames = build_macro_frames(prepared)
    micro_frames = build_micro_frames(prepared)
    timeout_frame = build_timeout_frame(prepared)

    write_analysis_level(
        "macro_averaged", macro_frames, timeout_frame, output_dir
    )
    write_analysis_level(
        "micro_averaged", micro_frames, timeout_frame, output_dir
    )


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Create macro test-level and micro question-level descriptive "
            "distribution plots without exporting private response text."
        )
    )
    parser.add_argument("input", type=Path, help="Private answer-level CSV or TSV.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("descriptive_output"),
        help="Directory for aggregate summaries and figures.",
    )
    return parser


def main() -> None:
    parser = build_argument_parser()
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        run_descriptive_analysis(args.input.resolve(), args.output_dir.resolve())
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
        return
    LOGGER.info("Descriptive outputs written to %s", args.output_dir.resolve())


if __name__ == "__main__":
    main()
