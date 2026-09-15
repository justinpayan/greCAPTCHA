"""Plot participant-level attempt scores for familiar and unfamiliar papers."""

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
    "attempt_score",
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
JITTER_LIMIT = 0.06
PNG_FILENAME = "participant_condition_score_scatterplots.png"


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
    return ", ".join(values.astype(str).drop_duplicates().head(limit))


def validate_and_collapse(frame: pd.DataFrame, source: Path) -> pd.DataFrame:
    """Validate answer rows and collapse each participant-condition test to one row."""
    frame["participant_id"] = frame["participant_id"].astype("string").str.strip()
    if frame["participant_id"].isna().any() or frame["participant_id"].eq("").any():
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
    if frame["paper_order"].isna().any():
        raise ValueError(
            f"{source} contains missing paper_order values; condition must be the "
            "corrected paper_order ('own' or 'foreign')."
        )

    frame["paper_order"] = (
        frame["paper_order"].astype("string").str.strip().str.lower()
    )
    observed_conditions = set(frame["paper_order"].unique())
    invalid_conditions = sorted(observed_conditions - set(CONDITION_ORDER))
    if invalid_conditions:
        raise ValueError(
            "paper_order must contain only corrected values 'own' and 'foreign'; "
            f"found: {', '.join(invalid_conditions)}. This script does not infer "
            "condition from paper_position."
        )

    original_scores = frame["attempt_score"]
    numeric_scores = pd.to_numeric(original_scores, errors="coerce")
    invalid_scores = original_scores.notna() & numeric_scores.isna()
    if invalid_scores.any():
        raise ValueError(
            f"{source} has nonnumeric attempt_score value(s), including: "
            f"{_format_examples(original_scores.loc[invalid_scores])}."
        )
    if numeric_scores.isna().any():
        raise ValueError(
            f"{source} contains missing attempt_score values; every test must have "
            "one repeated numeric score."
        )
    if np.isinf(numeric_scores.to_numpy(dtype=float)).any():
        raise ValueError(f"{source} contains infinite attempt_score values.")
    outside = numeric_scores.lt(0) | numeric_scores.gt(100)
    if outside.any():
        raise ValueError(
            "attempt_score must be between 0 and 100 inclusive; found: "
            f"{_format_examples(numeric_scores.loc[outside])}."
        )
    frame["attempt_score"] = numeric_scores.astype(float)

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

    score_counts = grouped["attempt_score"].nunique(dropna=False)
    inconsistent_scores = score_counts.loc[score_counts.ne(1)]
    if not inconsistent_scores.empty:
        examples = "; ".join(
            f"participant={key[0]}, paper_position={key[1]}"
            for key in inconsistent_scores.head(4).index
        )
        raise ValueError(
            "attempt_score must repeat unchanged across all 8 rows of each test. "
            f"Inconsistent test(s): {examples}."
        )

    tests = grouped.agg(
        condition=("paper_order", "first"),
        attempt_score=("attempt_score", "first"),
    ).reset_index()

    participant_condition_counts = (
        tests.groupby(["participant_id", "condition"], sort=True)
        .size()
        .rename("test_count")
    )
    duplicate_conditions = participant_condition_counts.loc[
        participant_condition_counts.ne(1)
    ]
    if not duplicate_conditions.empty:
        examples = "; ".join(
            f"participant={key[0]}, condition={key[1]} has {count} tests"
            for key, count in duplicate_conditions.head(4).items()
        )
        raise ValueError(
            "Each participant must have exactly one own test and one foreign test. "
            f"Repeated condition test(s): {examples}."
        )

    conditions_by_participant = (
        tests.groupby("participant_id", sort=True)["condition"].agg(set)
    )
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

    return tests.loc[
        :, ["participant_id", "paper_position", "condition", "attempt_score"]
    ].copy()


def _deterministic_jitter(participant_id: object) -> float:
    payload = str(participant_id).encode("utf-8")
    digest = hashlib.sha256(payload).digest()
    integer = int.from_bytes(digest[:8], byteorder="big", signed=False)
    unit = integer / float(2**64 - 1)
    return (2.0 * unit - 1.0) * JITTER_LIMIT


def prepare_export_data(tests: pd.DataFrame) -> pd.DataFrame:
    """Attach stable pseudonyms, condition labels, and deterministic jitter."""
    source_ids = sorted(tests["participant_id"].unique(), key=lambda value: str(value))
    pseudonyms = {
        participant_id: f"P{index:03d}"
        for index, participant_id in enumerate(source_ids, start=1)
    }
    exported = tests.copy()
    exported["participant_id"] = exported["participant_id"].map(pseudonyms)
    exported["condition_label"] = exported["condition"].map(CONDITION_LABELS)
    exported["jitter"] = [
        _deterministic_jitter(pseudonym)
        for pseudonym in exported["participant_id"]
    ]
    exported["x_position"] = exported["jitter"]
    condition_rank = {condition: index for index, condition in enumerate(CONDITION_ORDER)}
    exported["_condition_rank"] = exported["condition"].map(condition_rank)
    exported = exported.sort_values(
        ["_condition_rank", "participant_id"], kind="stable"
    ).drop(columns="_condition_rank")
    return exported.loc[
        :,
        [
            "participant_id",
            "condition",
            "condition_label",
            "paper_position",
            "attempt_score",
            "jitter",
            "x_position",
        ],
    ].reset_index(drop=True)


def summarize_conditions(exported: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for condition in CONDITION_ORDER:
        values = exported.loc[
            exported["condition"].eq(condition), "attempt_score"
        ]
        rows.append(
            {
                "condition": condition,
                "condition_label": CONDITION_LABELS[condition],
                "n": int(len(values)),
                "mean": float(values.mean()),
                "sd": float(values.std(ddof=1)) if len(values) > 1 else np.nan,
                "median": float(values.median()),
                "q1": float(values.quantile(0.25)),
                "q3": float(values.quantile(0.75)),
                "min": float(values.min()),
                "max": float(values.max()),
            }
        )
    return pd.DataFrame(rows)


def calculate_roc(exported: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Calculate empirical ROC coordinates with foreign paper as positive."""
    positive = exported["condition"].eq("foreign").astype(int)
    scores = 1.0 - exported["attempt_score"].astype(float) / 100.0
    false_positive_rate, true_positive_rate, thresholds = roc_curve(
        positive,
        scores,
        pos_label=1,
        drop_intermediate=False,
    )
    auc = float(roc_auc_score(positive, scores))
    curve = pd.DataFrame(
        {
            "false_positive_rate": false_positive_rate,
            "true_positive_rate": true_positive_rate,
            "threshold": thresholds,
        }
    )
    metric = pd.DataFrame(
        [
            {
                "auc": auc,
                "positive_class": "foreign",
                "negative_class": "own",
                "prediction_score": "1 - attempt_score/100",
                "n_positive": int(positive.sum()),
                "n_negative": int((1 - positive).sum()),
            }
        ]
    )
    return curve, metric


def build_description(
    summary: pd.DataFrame, auc: float
) -> tuple[str, str]:
    title = "Participant attempt scores and authorship discrimination"
    indexed = summary.set_index("condition")
    description = (
        "A two-panel figure. The left panel shows participant attempt scores "
        "from familiar own papers as blue circles in the left column and "
        "unfamiliar foreign papers as orange squares in the right column, on a "
        "shared score axis from 0 to 100. Small deterministic horizontal jitter "
        "reduces overplotting; points are not connected. Axis labels report n. "
        "White diamonds mark condition means and colored horizontal segments mark "
        "medians. Familiar scores have mean "
        f"{indexed.loc['own', 'mean']:.1f} and median "
        f"{indexed.loc['own', 'median']:.1f}; unfamiliar scores have mean "
        f"{indexed.loc['foreign', 'mean']:.1f} and median "
        f"{indexed.loc['foreign', 'median']:.1f}. The right panel is the empirical "
        "receiver operating characteristic curve obtained by using one minus "
        "the attempt score proportion to classify foreign versus own tests, with "
        "foreign as the positive class. "
        f"The area under the curve is {auc:.3f}. The diagonal denotes chance-level "
        "discrimination. These are descriptive summaries and do not establish "
        "causation."
    )
    return title, description


def make_figure(
    exported: pd.DataFrame,
    summary: pd.DataFrame,
    roc_data: pd.DataFrame,
    auc: float,
) -> plt.Figure:
    figure, axes = plt.subplots(
        1,
        2,
        figsize=(10.2, 5.8),
        gridspec_kw={"wspace": 0.42, "width_ratios": [1.05, 1]},
    )
    indexed = summary.set_index("condition")
    score_axis, roc_axis = axes
    for condition_index, condition in enumerate(CONDITION_ORDER):
        selected = exported.loc[exported["condition"].eq(condition)]
        color = CONDITION_COLORS[condition]
        score_axis.scatter(
            condition_index + 3 * selected["jitter"],
            selected["attempt_score"],
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
    score_axis.set_ylabel("Attempt score (0–100)")
    score_axis.grid(axis="y", color="#D9D9D9", linewidth=0.7, alpha=0.85)
    score_axis.set_axisbelow(True)
    score_axis.spines["top"].set_visible(False)
    score_axis.spines["right"].set_visible(False)
    score_axis.spines["bottom"].set_visible(False)

    roc_axis.plot(
        roc_data["false_positive_rate"],
        roc_data["true_positive_rate"],
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
    roc_axis.set_title("ROC: Predicting Unfamiliar Label with (1-score)")
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
        f"{float(row.attempt_score):.10g})"
        for row in frame.itertuples(index=False)
    )


def write_tikz(
    path: Path,
    exported: pd.DataFrame,
    summary: pd.DataFrame,
    roc_data: pd.DataFrame,
    auc: float,
    description: str,
) -> None:
    indexed = summary.set_index("condition")
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
            r"ylabel={Attempt score (0--100)},"
            r"]"
        ),
    ]
    for condition_index, condition in enumerate(CONDITION_ORDER):
        selected = exported.loc[exported["condition"].eq(condition)]
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
                    rf"\addplot[forget plot,only marks,mark=diamond*,mark size=3.4pt,"
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
        for row in roc_data.itertuples(index=False)
    )
    lines.extend(
        [
            (
                r"\nextgroupplot[xmin=0,xmax=1,ymin=0,ymax=1,"
                r"xtick={0,0.2,0.4,0.6,0.8,1},"
                r"ytick={0,0.2,0.4,0.6,0.8,1},"
                r"xlabel={False-positive rate},ylabel={True-positive rate}]"
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
    path.write_text(
        "\n".join(
            [
                "% Native TikZ/PGFPlots generated by plot_participant_attempt_scores.py.",
                "% Preamble requirements:",
                "% \\usepackage{tikz}",
                "% \\usepackage{pgfplots}",
                "% \\usepgfplotslibrary{groupplots}",
                "% \\usetikzlibrary{calc}",
                "% \\pgfplotsset{compat=1.18}",
                "% acmart provides \\Description.",
                "% For non-acmart classes: \\providecommand{\\Description}[1]{}",
                "% Path assumes compilation from the output root.",
                r"\input{latex/participant_condition_score_scatterplots.tex}",
                "",
            ]
        ),
        encoding="utf-8",
    )


def run(input_path: Path, output_dir: Path) -> None:
    input_path = input_path.resolve()
    output_dir = output_dir.resolve()
    frame = _read_input(input_path)
    tests = validate_and_collapse(frame, input_path)
    exported = prepare_export_data(tests)
    summary = summarize_conditions(exported)
    roc_data, auc_summary = calculate_roc(exported)
    auc = float(auc_summary.loc[0, "auc"])
    title, description = build_description(summary, auc)

    png_dir = output_dir / "png"
    latex_dir = output_dir / "latex"
    png_dir.mkdir(parents=True, exist_ok=True)
    latex_dir.mkdir(parents=True, exist_ok=True)

    figure = make_figure(exported, summary, roc_data, auc)
    figure.savefig(
        png_dir / PNG_FILENAME,
        dpi=260,
        bbox_inches="tight",
        facecolor="white",
        metadata={"Title": title, "Description": description},
    )
    plt.close(figure)

    exported.to_csv(output_dir / "participant_condition_scores.csv", index=False)
    summary.to_csv(output_dir / "condition_summary.csv", index=False)
    roc_data.to_csv(output_dir / "roc_curve.csv", index=False)
    auc_summary.to_csv(output_dir / "roc_auc.csv", index=False)
    (output_dir / "plot_description.txt").write_text(
        f"Title: {title}\n\nDescription: {description}\n",
        encoding="utf-8",
    )
    write_tikz(
        latex_dir / "participant_condition_score_scatterplots.tex",
        exported,
        summary,
        roc_data,
        auc,
        description,
    )
    write_all_plots(latex_dir / "all_plots.tex")

    metadata = {
        "source_path": str(input_path),
        "output_root": str(output_dir),
        "output_files": [
            f"png/{PNG_FILENAME}",
            "latex/participant_condition_score_scatterplots.tex",
            "latex/all_plots.tex",
            "plot_description.txt",
            "participant_condition_scores.csv",
            "condition_summary.csv",
            "roc_curve.csv",
            "roc_auc.csv",
            "analysis_metadata.json",
        ],
        "condition_semantics": {
            "source_column": "paper_order",
            "own": "familiar",
            "foreign": "unfamiliar",
            "note": (
                "Corrected paper_order is used directly; condition is never inferred "
                "from paper_position."
            ),
        },
        "validation": {
            "answer_rows_per_test": 8,
            "test_key": ["participant_id", "paper_position"],
            "required_tests_per_participant": ["own", "foreign"],
            "attempt_score_range": [0, 100],
        },
        "roc": {
            "auc": auc,
            "positive_class": "foreign",
            "negative_class": "own",
            "prediction_score": "1 - attempt_score/100",
            "interpretation": (
                "Probability that a randomly selected foreign-paper test has a "
                "higher unfamiliarity score (one minus the attempt-score "
                "proportion) than a "
                "randomly selected own-paper test, with ties receiving half credit."
            ),
        },
        "counts": {
            "raw_answer_rows": int(len(frame)),
            "validated_tests": int(len(tests)),
            "participants": int(tests["participant_id"].nunique()),
            "own_points": int(exported["condition"].eq("own").sum()),
            "foreign_points": int(exported["condition"].eq("foreign").sum()),
        },
        "privacy": (
            "Source participant IDs are replaced in exports by stable sequential "
            "pseudonyms based on sorted source IDs; source IDs are not written."
        ),
        "jitter": {
            "method": (
                "First 64 bits of SHA-256 over the exported pseudonym, mapped "
                "uniformly to [-0.06, 0.06]. The figure multiplies jitter by 3 "
                "around condition centers 0 (own) and 1 (unfamiliar)."
            ),
            "deterministic": True,
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
            "Create an overlaid participant attempt-score plot and ROC curve "
            "from full_data_answers.csv."
        )
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
        default=Path("participant_attempt_score_plots"),
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
