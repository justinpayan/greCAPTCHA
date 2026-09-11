"""Plot OpenRouter authorship probabilities for own and foreign papers."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


REQUIRED_COLUMNS = (
    "participant_id",
    "condition",
    "probability",
)
CONDITIONS = ("own", "foreign")
LABELS = {
    "own": "Own paper",
    "foreign": "Foreign paper",
}
COLORS = {
    "own": "#0072B2",
    "foreign": "#E69F00",
}
DESCRIPTION = (
    "Distribution of model-estimated authorship probabilities for tests about "
    "participants' own papers and foreign papers. Each jittered point is one "
    "participant-paper test. Boxes show the interquartile range, center lines "
    "show medians, whiskers extend to the most extreme observations within "
    "1.5 interquartile ranges, and diamonds show means. Sample sizes are "
    "printed above each condition."
)


def read_and_validate(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"Evaluation summary not found: {path}.")
    try:
        frame = pd.read_csv(path)
    except pd.errors.EmptyDataError as exc:
        raise ValueError(f"Evaluation summary is empty: {path}.") from exc
    except pd.errors.ParserError as exc:
        raise ValueError(f"Could not parse {path}: {exc}") from exc
    missing = sorted(set(REQUIRED_COLUMNS) - set(frame.columns))
    if missing:
        raise ValueError(
            f"{path} is missing required column(s): {', '.join(missing)}."
        )
    frame = frame.loc[:, REQUIRED_COLUMNS].copy()
    frame["participant_id"] = (
        frame["participant_id"].astype("string").str.strip()
    )
    frame["condition"] = frame["condition"].astype("string").str.strip().str.lower()
    frame["probability"] = pd.to_numeric(frame["probability"], errors="coerce")
    invalid = (
        frame["participant_id"].isna()
        | frame["participant_id"].eq("")
        | ~frame["condition"].isin(CONDITIONS)
        | frame["probability"].isna()
        | ~np.isfinite(frame["probability"])
        | frame["probability"].lt(0)
        | frame["probability"].gt(1)
    )
    if invalid.any():
        raise ValueError(
            f"{path} contains invalid participant IDs, conditions, or "
            "probabilities outside [0, 1]."
        )
    duplicates = frame.duplicated(
        ["participant_id", "condition"],
        keep=False,
    )
    if duplicates.any():
        examples = ", ".join(
            (
                frame.loc[duplicates, "participant_id"]
                + "/"
                + frame.loc[duplicates, "condition"]
            )
            .drop_duplicates()
            .head(5)
        )
        raise ValueError(
            "Each participant may have at most one result per condition; "
            f"duplicates include: {examples}."
        )
    missing_conditions = [
        condition for condition in CONDITIONS if condition not in set(frame["condition"])
    ]
    if missing_conditions:
        raise ValueError(
            "Both own and foreign results are required; missing: "
            + ", ".join(missing_conditions)
        )
    return frame


def deterministic_jitter(participant_id: str, condition: str) -> float:
    digest = hashlib.sha256(
        f"{participant_id}|{condition}".encode("utf-8")
    ).digest()
    unit = int.from_bytes(digest[:8], "big") / (2**64 - 1)
    return (unit - 0.5) * 0.24


def tukey_statistics(values: np.ndarray) -> dict[str, float]:
    q1, median, q3 = np.quantile(values, [0.25, 0.5, 0.75])
    iqr = q3 - q1
    lower_candidates = values[values >= q1 - 1.5 * iqr]
    upper_candidates = values[values <= q3 + 1.5 * iqr]
    return {
        "lower_whisker": float(lower_candidates.min()),
        "q1": float(q1),
        "median": float(median),
        "q3": float(q3),
        "upper_whisker": float(upper_candidates.max()),
        "mean": float(values.mean()),
    }


def make_summary(frame: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for condition in CONDITIONS:
        values = frame.loc[
            frame["condition"].eq(condition),
            "probability",
        ].to_numpy(dtype=float)
        stats = tukey_statistics(values)
        rows.append(
            {
                "condition": condition,
                "condition_label": LABELS[condition],
                "n_tests": len(values),
                "mean_probability": stats["mean"],
                "sd_probability": (
                    float(values.std(ddof=1)) if len(values) > 1 else np.nan
                ),
                "median_probability": stats["median"],
                "q1_probability": stats["q1"],
                "q3_probability": stats["q3"],
                "minimum_probability": float(values.min()),
                "maximum_probability": float(values.max()),
            }
        )
    return pd.DataFrame(rows)


def write_png(frame: pd.DataFrame, output_path: Path) -> None:
    fig, axis = plt.subplots(figsize=(7.2, 5.4), constrained_layout=True)
    data = [
        frame.loc[frame["condition"].eq(condition), "probability"].to_numpy(
            dtype=float
        )
        for condition in CONDITIONS
    ]
    boxes = axis.boxplot(
        data,
        positions=[1, 2],
        widths=0.48,
        patch_artist=True,
        showfliers=False,
        medianprops={"color": "#222222", "linewidth": 2},
        whiskerprops={"color": "#555555", "linewidth": 1.2},
        capprops={"color": "#555555", "linewidth": 1.2},
    )
    for box, condition in zip(boxes["boxes"], CONDITIONS, strict=True):
        box.set_facecolor(COLORS[condition])
        box.set_alpha(0.32)
        box.set_edgecolor(COLORS[condition])
        box.set_linewidth(1.5)

    for x_position, condition, values in zip(
        (1, 2),
        CONDITIONS,
        data,
        strict=True,
    ):
        condition_rows = frame.loc[frame["condition"].eq(condition)]
        x_values = [
            x_position + deterministic_jitter(str(participant), condition)
            for participant in condition_rows["participant_id"]
        ]
        axis.scatter(
            x_values,
            condition_rows["probability"],
            color=COLORS[condition],
            edgecolor="white",
            linewidth=0.55,
            alpha=0.82,
            s=40,
            zorder=3,
        )
        axis.scatter(
            [x_position],
            [values.mean()],
            marker="D",
            color=COLORS[condition],
            edgecolor="black",
            linewidth=0.7,
            s=72,
            zorder=4,
        )
        axis.text(
            x_position,
            1.035,
            f"n = {len(values)} tests",
            ha="center",
            va="bottom",
            fontsize=10,
        )

    axis.set_xticks([1, 2], [LABELS[value] for value in CONDITIONS])
    axis.set_xlim(0.5, 2.5)
    axis.set_ylim(0, 1.1)
    axis.set_yticks(np.linspace(0, 1, 6))
    axis.set_ylabel("Estimated probability of authorship")
    axis.set_xlabel("Paper condition")
    axis.set_title("Authorship Probability by Paper Condition", pad=17)
    axis.grid(axis="y", color="#D9D9D9", linewidth=0.8, alpha=0.8)
    axis.set_axisbelow(True)
    for spine in ("top", "right"):
        axis.spines[spine].set_visible(False)
    fig.savefig(
        output_path,
        dpi=300,
        metadata={"Description": DESCRIPTION},
    )
    plt.close(fig)


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
    }
    return "".join(replacements.get(character, character) for character in text)


def write_latex(frame: pd.DataFrame, output_path: Path) -> None:
    lines = [
        r"% Requires \usepackage{pgfplots}",
        r"% Requires \usepgfplotslibrary{statistics}",
        r"\begin{tikzpicture}",
        r"\definecolor{ownColor}{HTML}{0072B2}",
        r"\definecolor{foreignColor}{HTML}{E69F00}",
        r"\begin{axis}[",
        r"  width=0.78\linewidth, height=7.1cm,",
        r"  ymin=0, ymax=1.10, xmin=0.5, xmax=2.5,",
        r"  xtick={1,2},",
        r"  xticklabels={Own paper,Foreign paper},",
        r"  ylabel={Estimated probability of authorship},",
        r"  xlabel={Paper condition},",
        r"  title={Authorship Probability by Paper Condition},",
        r"  ymajorgrids=true, grid style={gray!25},",
        r"  tick label style={font=\small},",
        r"]",
    ]
    for x_position, condition in zip((1, 2), CONDITIONS, strict=True):
        rows = frame.loc[frame["condition"].eq(condition)]
        values = rows["probability"].to_numpy(dtype=float)
        stats = tukey_statistics(values)
        color = "ownColor" if condition == "own" else "foreignColor"
        lines.extend(
            [
                rf"\addplot+[{color}, fill={color}!25, boxplot prepared={{",
                rf"  draw position={x_position},",
                rf"  lower whisker={stats['lower_whisker']:.8f},",
                rf"  lower quartile={stats['q1']:.8f},",
                rf"  median={stats['median']:.8f},",
                rf"  upper quartile={stats['q3']:.8f},",
                rf"  upper whisker={stats['upper_whisker']:.8f}",
                r"}] coordinates {};",
            ]
        )
        for participant, probability in zip(
            rows["participant_id"],
            rows["probability"],
            strict=True,
        ):
            x_value = x_position + deterministic_jitter(
                str(participant),
                condition,
            )
            lines.append(
                rf"\addplot+[only marks, mark=*, mark size=1.7pt, "
                rf"draw=white, fill={color}] coordinates "
                rf"{{({x_value:.8f},{float(probability):.8f})}};"
            )
        lines.extend(
            [
                rf"\addplot+[only marks, mark=diamond*, mark size=3pt, "
                rf"draw=black, fill={color}] coordinates "
                rf"{{({x_position},{stats['mean']:.8f})}};",
                rf"\node[anchor=south] at (axis cs:{x_position},1.025) "
                rf"{{\small $n={len(values)}$ tests}};",
            ]
        )
    lines.extend(
        [
            r"\end{axis}",
            r"\end{tikzpicture}",
            rf"\Description{{{_latex_escape(DESCRIPTION)}}}",
            "",
        ]
    )
    output_path.write_text("\n".join(lines), encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Plot own-versus-foreign OpenRouter authorship probabilities."
        )
    )
    parser.add_argument(
        "summary_csv",
        type=Path,
        help="Path to authorship_evaluation_summary.csv.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("authorship_evaluation_distribution"),
        help="Directory for PNG, LaTeX, description, and summary outputs.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        source = args.summary_csv.resolve()
        output_dir = args.output_dir.resolve()
        latex_dir = output_dir / "latex"
        output_dir.mkdir(parents=True, exist_ok=True)
        latex_dir.mkdir(parents=True, exist_ok=True)
        frame = read_and_validate(source)
        make_summary(frame).to_csv(
            output_dir / "distribution_summary.csv",
            index=False,
            lineterminator="\n",
        )
        write_png(
            frame,
            output_dir / "own_vs_foreign_authorship_distribution.png",
        )
        write_latex(
            frame,
            latex_dir / "own_vs_foreign_authorship_distribution.tex",
        )
        (output_dir / "plot_description.txt").write_text(
            DESCRIPTION + "\n",
            encoding="utf-8",
        )
    except (FileNotFoundError, OSError, RuntimeError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
