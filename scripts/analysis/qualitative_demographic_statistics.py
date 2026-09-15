"""Compare qualitative-code annotation counts by participant seniority."""

from __future__ import annotations

import argparse
import logging
import re
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Patch


LOGGER = logging.getLogger("qualitative_demographic_statistics")

COLORS = ("#0072B2", "#E69F00")
HATCHES = ("///", r"\\\\")
TIKZ_PATTERNS = ("north east lines", "north west lines")
COMPARISON_CONFIG = {
    "seniority": {
        "order": ("junior", "senior"),
        "labels": {
            "junior": "Junior (Master’s and PhD)",
            "senior": "Senior (Postdoc and Professor)",
        },
        "title": "Top qualitative codes by junior–senior difference",
        "filename": "top_codes_by_seniority",
        "summary_filename": "code_seniority_summary.csv",
    },
    "paper_year": {
        "order": ("earlier", "year_2026"),
        "labels": {
            "earlier": "Own paper before 2026",
            "year_2026": "Own paper in 2026",
        },
        "title": "Top qualitative codes by own-paper year difference",
        "filename": "top_codes_by_paper_year",
        "summary_filename": "code_paper_year_summary.csv",
    },
    "own_score": {
        "order": ("bottom_half", "top_half"),
        "labels": {
            "bottom_half": "Below median own-paper score",
            "top_half": "At or above median own-paper score",
        },
        "title": "Top qualitative codes by own-paper score group",
        "filename": "top_codes_by_own_score",
        "summary_filename": "code_own_score_summary.csv",
    },
}


def _read_table(path: Path, name: str) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"{name} does not exist: {path}")
    errors: list[str] = []
    for options in (
        {"sep": ",", "engine": "c"},
        {"sep": "\t", "engine": "c"},
        {"sep": None, "engine": "python", "skipinitialspace": True},
    ):
        try:
            data = pd.read_csv(
                path,
                dtype=str,
                keep_default_na=False,
                na_filter=False,
                encoding="utf-8-sig",
                **options,
            )
        except Exception as exc:
            errors.append(str(exc))
            continue
        if len(data.columns) > 1:
            return data
    detail = errors[0] if errors else "no delimiter produced multiple columns"
    raise ValueError(f"Could not parse {name} '{path}': {detail}")


def _normalized_header(value: Any) -> str:
    return " ".join(str(value).strip().lower().replace("_", " ").split())


def _resolve_column(
    data: pd.DataFrame, aliases: tuple[str, ...], source_name: str
) -> str:
    normalized_aliases = {_normalized_header(alias) for alias in aliases}
    matches = [
        column
        for column in data.columns
        if _normalized_header(column) in normalized_aliases
    ]
    if len(matches) != 1:
        raise ValueError(
            f"{source_name} must contain exactly one of: "
            + ", ".join(aliases)
            + ". Parsed columns were: "
            + ", ".join(str(column) for column in data.columns)
        )
    return matches[0]


def _seniority_group(value: str) -> str | None:
    normalized = (
        value.strip()
        .lower()
        .replace("’", "'")
        .replace(".", "")
        .replace("-", " ")
    )
    if not normalized:
        return None
    if "postdoc" in normalized or "post doc" in normalized:
        return "senior"
    if "professor" in normalized or "faculty" in normalized:
        return "senior"
    if "master" in normalized:
        return "junior"
    if (
        "phd" in normalized.replace(" ", "")
        or "doctoral" in normalized
        or "doctorate" in normalized
    ):
        return "junior"
    return None


def prepare_inputs(
    code_matrix: pd.DataFrame, participants: pd.DataFrame
) -> tuple[pd.DataFrame, dict[str, dict[str, str]], float]:
    """Validate inputs and map interviews for all requested comparisons."""
    if code_matrix.empty:
        raise ValueError("Code-comparison matrix contains no code rows.")
    code_column = code_matrix.columns[0]
    interview_columns = [str(column).strip() for column in code_matrix.columns[1:]]
    if not interview_columns:
        raise ValueError("Code-comparison matrix contains no interview columns.")
    if any(not column for column in interview_columns):
        raise ValueError("Code-comparison matrix has a blank interview filename.")
    if len(interview_columns) != len(set(interview_columns)):
        duplicates = sorted(
            {
                column
                for column in interview_columns
                if interview_columns.count(column) > 1
            }
        )
        raise ValueError(
            "Code-comparison matrix has duplicate interview columns: "
            + ", ".join(duplicates)
        )

    matrix = code_matrix.copy()
    matrix.columns = [str(code_column).strip(), *interview_columns]
    code_names = matrix.iloc[:, 0].astype(str).str.strip()
    blank_codes = code_names.eq("")
    if blank_codes.any():
        rows = (blank_codes[blank_codes].index + 2).tolist()[:8]
        raise ValueError(f"Qualitative code label is blank at rows {rows}.")
    duplicate_codes = code_names.duplicated(keep=False)
    if duplicate_codes.any():
        values = sorted(code_names.loc[duplicate_codes].unique().tolist())
        raise ValueError("Duplicate qualitative code labels: " + ", ".join(values))
    matrix.iloc[:, 0] = code_names

    blank_locations: list[str] = []
    invalid_locations: list[str] = []
    negative_locations: list[str] = []
    parsed_columns: dict[str, pd.Series] = {}
    for interview in interview_columns:
        raw = matrix[interview].astype(str).str.strip()
        blank = raw.eq("")
        blank_locations.extend(
            f"{code_names.loc[index]} / {interview}"
            for index in raw.index[blank]
        )
        numeric = pd.to_numeric(raw.where(~blank), errors="coerce")
        invalid = ~blank & (
            numeric.isna()
            | ~np.isclose(numeric.fillna(0), np.round(numeric.fillna(0)))
        )
        invalid_locations.extend(
            f"{code_names.loc[index]} / {interview}"
            for index in raw.index[invalid]
        )
        negative = ~blank & numeric.lt(0)
        negative_locations.extend(
            f"{code_names.loc[index]} / {interview}"
            for index in raw.index[negative]
        )
        parsed_columns[interview] = numeric
    if blank_locations:
        raise ValueError(
            "Blank annotation-count cells found: "
            + ", ".join(blank_locations[:12])
        )
    if invalid_locations:
        raise ValueError(
            "Non-integer annotation counts found: "
            + ", ".join(invalid_locations[:12])
        )
    if negative_locations:
        raise ValueError(
            "Negative annotation counts found: "
            + ", ".join(negative_locations[:12])
        )
    for interview, numeric in parsed_columns.items():
        matrix[interview] = numeric.astype(int)

    file_column = _resolve_column(
        participants, ("file_name", "file name"), "participants_combined.csv"
    )
    job_column = _resolve_column(
        participants, ("job_title", "job title"), "participants_combined.csv"
    )
    paper_date_column = _resolve_column(
        participants,
        ("own_paper_date", "own paper date"),
        "participants_combined.csv",
    )
    own_score_column = _resolve_column(
        participants,
        ("own_score", "own score"),
        "participants_combined.csv",
    )
    filenames = participants[file_column].astype(str).str.strip()
    blank_filenames = filenames.eq("")
    if blank_filenames.any():
        rows = (blank_filenames[blank_filenames].index + 2).tolist()[:8]
        raise ValueError(f"participants_combined.csv has blank file_name at rows {rows}.")
    duplicate_filenames = filenames.duplicated(keep=False)
    if duplicate_filenames.any():
        values = sorted(filenames.loc[duplicate_filenames].unique().tolist())
        raise ValueError(
            "participants_combined.csv has duplicate file_name values: "
            + ", ".join(values)
        )

    participant_by_file = participants.copy()
    participant_by_file["_file_name"] = filenames
    participant_by_file = participant_by_file.set_index("_file_name")
    unmatched = sorted(set(interview_columns) - set(participant_by_file.index))
    if unmatched:
        raise ValueError(
            "Interview columns missing from participants_combined.csv: "
            + ", ".join(unmatched)
        )

    comparison_groups: dict[str, dict[str, str]] = {
        name: {} for name in COMPARISON_CONFIG
    }
    unknown_titles: list[str] = []
    invalid_dates: list[str] = []
    invalid_scores: list[str] = []
    own_scores: dict[str, float] = {}
    for interview in interview_columns:
        title = str(participant_by_file.loc[interview, job_column]).strip()
        group = _seniority_group(title)
        if group is None:
            unknown_titles.append(f"{interview}: {title or '[blank]'}")
        else:
            comparison_groups["seniority"][interview] = group

        paper_date = str(
            participant_by_file.loc[interview, paper_date_column]
        ).strip()
        if paper_date:
            match = re.search(r"(?:19|20)\d{2}", paper_date)
            if match is None:
                invalid_dates.append(f"{interview}: {paper_date}")
            else:
                year = int(match.group())
                if year <= 2025:
                    comparison_groups["paper_year"][interview] = "earlier"
                elif year == 2026:
                    comparison_groups["paper_year"][interview] = "year_2026"
                else:
                    invalid_dates.append(f"{interview}: {paper_date}")

        score_text = str(
            participant_by_file.loc[interview, own_score_column]
        ).strip()
        if score_text:
            try:
                score = float(score_text)
            except ValueError:
                invalid_scores.append(f"{interview}: {score_text}")
            else:
                if np.isfinite(score):
                    own_scores[interview] = score
                else:
                    invalid_scores.append(f"{interview}: {score_text}")
    if unknown_titles:
        raise ValueError(
            "Blank or unrecognized job titles for matrix interviews: "
            + ", ".join(unknown_titles)
        )
    if invalid_dates:
        raise ValueError(
            "Invalid nonblank own_paper_date values: " + ", ".join(invalid_dates)
        )
    if invalid_scores:
        raise ValueError(
            "Invalid nonblank own_score values: " + ", ".join(invalid_scores)
        )
    if not own_scores:
        raise ValueError("No nonblank numeric own_score values are available.")
    own_score_median = float(np.median(list(own_scores.values())))
    for interview, score in own_scores.items():
        comparison_groups["own_score"][interview] = (
            "top_half" if score >= own_score_median else "bottom_half"
        )

    for comparison, config in COMPARISON_CONFIG.items():
        assigned = comparison_groups[comparison]
        for group in config["order"]:
            if group not in assigned.values():
                raise ValueError(
                    f"No participants are available in the {comparison} "
                    f"group '{group}'."
                )
    return matrix, comparison_groups, own_score_median


def summarize_codes(
    matrix: pd.DataFrame,
    group_by_interview: dict[str, str],
    comparison: str,
    group_order: tuple[str, str],
) -> pd.DataFrame:
    code_column = matrix.columns[0]
    group_columns = {
        group: [
            interview
            for interview, assigned_group in group_by_interview.items()
            if assigned_group == group
        ]
        for group in group_order
    }
    first_group, second_group = group_order
    rows: list[dict[str, Any]] = []
    for _, row in matrix.iterrows():
        code = str(row[code_column])
        first_values = row[group_columns[first_group]].astype(float)
        second_values = row[group_columns[second_group]].astype(float)
        first_mean = float(first_values.mean())
        second_mean = float(second_values.mean())
        difference = first_mean - second_mean
        rows.append(
            {
                "code": code,
                "comparison": comparison,
                f"{first_group}_n": len(group_columns[first_group]),
                f"{first_group}_mean": first_mean,
                f"{second_group}_n": len(group_columns[second_group]),
                f"{second_group}_mean": second_mean,
                f"{first_group}_minus_{second_group}": difference,
                "absolute_difference": abs(difference),
            }
        )
    summary = pd.DataFrame(rows).sort_values(
        ["absolute_difference", "code"],
        ascending=[False, True],
        kind="stable",
    )
    summary["absolute_difference_rank"] = np.arange(1, len(summary) + 1)
    return summary.reset_index(drop=True)


def plot_top_codes(
    summary: pd.DataFrame,
    group_order: tuple[str, str],
    group_labels: dict[str, str],
    title: str,
) -> plt.Figure:
    top = summary.head(10).copy()
    positions = np.arange(len(top))
    height = 0.34
    figure_height = max(5.5, 0.58 * len(top) + 2.0)
    fig, ax = plt.subplots(figsize=(11.5, figure_height))
    mean_columns = [f"{group}_mean" for group in group_order]
    maximum = float(top[mean_columns].max().max())
    for group_index, (offset, group) in enumerate(
        zip((-height / 2, height / 2), group_order, strict=True)
    ):
        values = top[f"{group}_mean"].to_numpy(dtype=float)
        bars = ax.barh(
            positions + offset,
            values,
            height=height,
            color=COLORS[group_index],
            edgecolor=COLORS[group_index],
            hatch=HATCHES[group_index],
            alpha=0.75,
            label=f"{group_labels[group]} (n={int(top[f'{group}_n'].iloc[0])})",
        )
        label_offset = max(0.03, maximum * 0.015)
        for bar, value in zip(bars, values, strict=True):
            ax.text(
                value + label_offset,
                bar.get_y() + bar.get_height() / 2,
                f"{value:.2f}",
                ha="left",
                va="center",
                fontsize=8,
            )
    ax.set_xlim(0, maximum + max(0.5, maximum * 0.18))
    ax.set_yticks(positions)
    ax.set_yticklabels(top["code"])
    ax.invert_yaxis()
    ax.set_xlabel("Average annotations per participant")
    ax.set_title(title)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="x", color="#D9D9D9", linewidth=0.6, alpha=0.8)
    ax.set_axisbelow(True)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.10), ncol=2, frameon=False)
    fig.tight_layout(rect=(0, 0.06, 1, 1))
    return fig


def _latex_escape(value: Any) -> str:
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
        "’": "'",
    }
    return "".join(
        replacements.get(character, character) for character in str(value)
    )


def write_top_codes_tikz(
    summary: pd.DataFrame,
    group_order: tuple[str, str],
    group_labels: dict[str, str],
    title: str,
    output_path: Path,
) -> None:
    top = summary.head(10).copy()
    mean_columns = [f"{group}_mean" for group in group_order]
    maximum = float(top[mean_columns].max().max())
    x_max = maximum + max(0.5, maximum * 0.18)
    positions = list(range(len(top)))
    y_ticks = ",".join(str(position) for position in positions)
    y_labels = ",".join(
        "{" + _latex_escape(code) + "}" for code in top["code"]
    )
    group_sizes = {
        group: int(top[f"{group}_n"].iloc[0]) for group in group_order
    }
    height = max(7.0, 1.0 + 0.62 * len(top))
    lines = [
        r"\ifdefined\tikzexternaldisable\tikzexternaldisable\fi",
        r"\begin{tikzpicture}",
        r"\definecolor{groupColor0}{HTML}{0072B2}",
        r"\definecolor{groupColor1}{HTML}{E69F00}",
        r"\begin{axis}[",
        rf"width=0.96\linewidth,height={height:.3g}cm,",
        f"xmin=0,xmax={x_max:.8g},",
        f"ymin=-0.7,ymax={len(top) - 0.3:.8g},",
        f"ytick={{{y_ticks}}},",
        f"yticklabels={{{y_labels}}},",
        r"y dir=reverse,",
        r"xlabel={Average annotations per participant},",
        rf"title={{{_latex_escape(title)}}},",
        r"axis lines*=left,xmajorgrids,clip=false,",
        r"grid style={draw=gray!30,line width=0.4pt},",
        r"legend style={at={(0.5,-0.12)},anchor=north,draw=none,legend columns=2},",
        r"]",
    ]
    bar_height = 0.28
    label_offset = max(0.03, maximum * 0.015)
    for index, row in top.reset_index(drop=True).iterrows():
        for group_index, (group, center) in enumerate(
            zip(group_order, (index - 0.18, index + 0.18), strict=True)
        ):
            value = float(row[f"{group}_mean"])
            color = f"groupColor{group_index}"
            pattern = TIKZ_PATTERNS[group_index]
            lines.extend(
                [
                    (
                        rf"\draw[draw={color},fill={color}!15,pattern={pattern},"
                        rf"pattern color={color}] "
                        rf"(axis cs:0,{center - bar_height / 2:.8g}) rectangle "
                        rf"(axis cs:{value:.8g},{center + bar_height / 2:.8g});"
                    ),
                    (
                        rf"\node[anchor=west,font=\scriptsize] at "
                        rf"(axis cs:{value + label_offset:.8g},{center:.8g}) "
                        rf"{{{value:.2f}}};"
                    ),
                ]
            )
    for group_index, group in enumerate(group_order):
        n = group_sizes[group]
        color = f"groupColor{group_index}"
        pattern = TIKZ_PATTERNS[group_index]
        lines.extend(
            [
                (
                    rf"\addlegendimage{{legend image code/.code={{"
                    rf"\draw[draw={color},fill={color}!15,pattern={pattern},"
                    rf"pattern color={color}] "
                    rf"(0cm,-0.08cm) rectangle (0.34cm,0.08cm);}}}}"
                ),
                rf"\addlegendentry{{{_latex_escape(group_labels[group])} ($n={n}$)}}",
            ]
        )
    description_entries = "; ".join(
        f"{row.code}: {group_labels[group_order[0]]} mean "
        f"{getattr(row, f'{group_order[0]}_mean'):.2f}, "
        f"{group_labels[group_order[1]]} mean "
        f"{getattr(row, f'{group_order[1]}_mean'):.2f}"
        for row in top.itertuples()
    )
    description = (
        "Horizontal grouped bar chart of the ten qualitative codes with the "
        "largest absolute difference in mean annotation count between "
        f"{group_labels[group_order[0]]} and {group_labels[group_order[1]]}. "
        f"Group sample sizes are {group_sizes[group_order[0]]} and "
        f"{group_sizes[group_order[1]]}, respectively. Displayed values are: "
        f"{description_entries}."
    )
    lines.extend(
        [
            r"\end{axis}",
            r"\end{tikzpicture}",
            r"\ifdefined\tikzexternalenable\tikzexternalenable\fi",
            rf"\Description{{{_latex_escape(description)}}}",
            "",
        ]
    )
    output_path.write_text("\n".join(lines), encoding="utf-8")


def run_analysis(
    code_comparisons_path: Path,
    participants_path: Path,
    output_dir: Path,
) -> None:
    code_matrix = _read_table(code_comparisons_path, "code_comparisons.csv")
    participants = _read_table(
        participants_path, "participants_combined.csv"
    )
    matrix, comparison_groups, own_score_median = prepare_inputs(
        code_matrix, participants
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    for comparison, config in COMPARISON_CONFIG.items():
        group_order = config["order"]
        group_labels = dict(config["labels"])
        if comparison == "own_score":
            group_labels = {
                "bottom_half": f"Own score below {own_score_median:g}",
                "top_half": f"Own score at or above {own_score_median:g}",
            }
        summary = summarize_codes(
            matrix,
            comparison_groups[comparison],
            comparison,
            group_order,
        )
        if comparison == "own_score":
            summary["own_score_median"] = own_score_median
        summary.to_csv(
            output_dir / str(config["summary_filename"]), index=False
        )

        figure = plot_top_codes(
            summary, group_order, group_labels, str(config["title"])
        )
        filename = str(config["filename"])
        figure.savefig(
            output_dir / f"{filename}.png",
            dpi=200,
            bbox_inches="tight",
            facecolor="white",
        )
        plt.close(figure)
        write_top_codes_tikz(
            summary,
            group_order,
            group_labels,
            str(config["title"]),
            output_dir / f"{filename}.tex",
        )


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Compare qualitative-code annotation counts by seniority, "
            "own-paper year, and own-paper score group."
        )
    )
    parser.add_argument(
        "code_comparisons",
        type=Path,
        help="Code-by-interview count matrix CSV or TSV.",
    )
    parser.add_argument(
        "participants_combined",
        type=Path,
        help=(
            "Participant metadata CSV or TSV with file_name, job_title, "
            "own_paper_date, and own_score."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("qualitative_demographic_output"),
        help="Directory for aggregate CSV, PNG, and TikZ outputs.",
    )
    return parser


def main() -> None:
    parser = build_argument_parser()
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        run_analysis(
            args.code_comparisons.resolve(),
            args.participants_combined.resolve(),
            args.output_dir.resolve(),
        )
    except (FileNotFoundError, ValueError) as exc:
        parser.error(str(exc))
        return
    LOGGER.info(
        "Qualitative demographic outputs written to %s",
        args.output_dir.resolve(),
    )


if __name__ == "__main__":
    main()
