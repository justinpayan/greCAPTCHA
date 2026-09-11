"""Create aggregate demographic figures without exporting participant-level data."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


LOGGER = logging.getLogger("demographic_statistics")

REQUIRED_COLUMNS = {
    "participant_id",
    "preparation_time",
    "published_papers",
    "job_title",
}
TAXONOMY_COLUMN = "arxiv field taxonomy"
TAXONOMY_ID_COLUMN = "participant id (links experimental data to participant)"
PUBLICATION_EDGES = [0, 5, 10, 20, 50, np.inf]
PUBLICATION_LABELS = ["0–4", "5–9", "10–19", "20–49", "50+"]

COLORS = [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#D55E00",
    "#56B4E9",
    "#F0E442",
    "#666666",
]
HATCHES = ["///", r"\\\\", "xx", "---", "|||", "...", "++", "oo"]
TIKZ_PATTERNS = [
    "north east lines",
    "north west lines",
    "crosshatch",
    "horizontal lines",
    "vertical lines",
    "dots",
    "grid",
    "checkerboard",
]


def _read_input(path: Path) -> pd.DataFrame:
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

    data.columns = [str(column).strip().lower() for column in data.columns]
    if len(data.columns) != len(set(data.columns)):
        raise ValueError("Input contains duplicate column names after normalization.")
    missing = sorted(REQUIRED_COLUMNS - set(data.columns))
    if missing:
        raise ValueError(f"Input is missing required columns: {', '.join(missing)}")
    return data


def _read_taxonomy_input(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"Taxonomy input file does not exist: {path}")
    parse_errors: list[str] = []
    parsed_without_taxonomy = False
    attempts = [
        {"sep": ",", "engine": "c"},
        {"sep": "\t", "engine": "c"},
        {"sep": None, "engine": "python", "skipinitialspace": True},
    ]
    for options in attempts:
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
            parse_errors.append(str(exc))
            continue
        data.columns = [
            " ".join(str(column).strip().lower().split())
            for column in data.columns
        ]
        required = {TAXONOMY_ID_COLUMN, TAXONOMY_COLUMN}
        if not required.issubset(data.columns):
            parsed_without_taxonomy = parsed_without_taxonomy or len(data.columns) > 1
            continue
        if len(data.columns) != len(set(data.columns)):
            raise ValueError(
                "Taxonomy input contains duplicate column names after normalization."
            )
        return data

    if parsed_without_taxonomy:
        required = {TAXONOMY_ID_COLUMN, TAXONOMY_COLUMN}
        raise ValueError(
            "Taxonomy input is missing required columns: "
            + ", ".join(sorted(required))
        )
    details = parse_errors[0] if parse_errors else "unknown parser error"
    raise ValueError(
        f"Could not parse taxonomy input '{path}' as CSV or TSV: {details}"
    )


def match_interviewed_participants(
    participants: pd.DataFrame, metadata: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Keep only participant IDs represented in both input files."""
    participant_ids = participants["participant_id"].astype(str).str.strip()
    metadata_ids = metadata[TAXONOMY_ID_COLUMN].astype(str).str.strip()
    if participant_ids.eq("").any():
        rows = (participant_ids.eq("")[
            participant_ids.eq("")
        ].index + 2).tolist()[:8]
        raise ValueError(f"participant_id is blank at participant rows {rows}.")

    participant_keys = participant_ids.str.casefold()
    metadata_keys = metadata_ids.str.casefold()
    duplicate_participants = participant_keys.duplicated(keep=False)
    if duplicate_participants.any():
        values = sorted(
            participant_ids.loc[duplicate_participants].drop_duplicates().tolist()
        )
        raise ValueError(
            "Participant CSV contains duplicate participant IDs: "
            + ", ".join(values)
        )

    metadata_key_set = set(metadata_keys.loc[metadata_keys.ne("")])
    included = participant_keys.isin(metadata_key_set)
    excluded_ids = sorted(participant_ids.loc[~included].tolist())
    if excluded_ids:
        LOGGER.warning(
            "Excluding participant IDs absent from interview metadata (%d): %s",
            len(excluded_ids),
            ", ".join(excluded_ids),
        )
    else:
        LOGGER.info("All participant IDs are present in interview metadata.")

    matched_participants = participants.loc[included].copy()
    matched_keys = set(participant_keys.loc[included])
    matched_metadata = metadata.loc[metadata_keys.isin(matched_keys)].copy()
    matched_metadata["_participant_key"] = metadata_keys.loc[
        metadata_keys.isin(matched_keys)
    ]
    duplicate_metadata = matched_metadata["_participant_key"].duplicated(
        keep=False
    )
    if duplicate_metadata.any():
        duplicate_ids = sorted(
            matched_metadata.loc[
                duplicate_metadata, TAXONOMY_ID_COLUMN
            ]
            .astype(str)
            .str.strip()
            .drop_duplicates()
            .tolist()
        )
        LOGGER.warning(
            "Metadata has duplicate rows for participant IDs; using the first "
            "row for each (%d): %s",
            len(duplicate_ids),
            ", ".join(duplicate_ids),
        )
        matched_metadata = matched_metadata.drop_duplicates(
            "_participant_key", keep="first"
        )
    matched_metadata = matched_metadata.drop(columns="_participant_key")
    if matched_participants.empty:
        raise ValueError(
            "No participant IDs from the participant CSV are present in metadata."
        )
    return matched_participants, matched_metadata


def _optional_numeric(
    series: pd.Series, column: str, integer: bool = False
) -> pd.Series:
    stripped = series.astype(str).str.strip()
    present = stripped.ne("")
    parsed = pd.to_numeric(stripped.where(present), errors="coerce")
    invalid = present & parsed.isna()
    if invalid.any():
        rows = (invalid[invalid].index + 2).tolist()[:8]
        raise ValueError(
            f"Column '{column}' has non-numeric values at input rows {rows}."
        )
    if integer:
        non_integer = present & ~np.isclose(parsed.fillna(0), np.round(parsed.fillna(0)))
        if non_integer.any():
            rows = (non_integer[non_integer].index + 2).tolist()[:8]
            raise ValueError(
                f"Column '{column}' must contain integers; check input rows {rows}."
            )
    negative = present & parsed.lt(0)
    if negative.any():
        rows = (negative[negative].index + 2).tolist()[:8]
        raise ValueError(
            f"Column '{column}' cannot be negative; check input rows {rows}."
        )
    return parsed.dropna().astype(int if integer else float)


def prepare_demographic_data(
    data: pd.DataFrame,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return nonmissing preparation, publication, and job-title values."""
    preparation = _optional_numeric(data["preparation_time"], "preparation_time")
    publications = _optional_numeric(
        data["published_papers"], "published_papers", integer=True
    )
    job_titles = data["job_title"].astype(str).str.strip()
    job_titles = job_titles.loc[job_titles.ne("")]
    return preparation, publications, job_titles


def publication_counts(publications: pd.Series) -> pd.Series:
    buckets = pd.cut(
        publications,
        bins=PUBLICATION_EDGES,
        labels=PUBLICATION_LABELS,
        right=False,
        include_lowest=True,
    )
    return buckets.value_counts(sort=False).reindex(PUBLICATION_LABELS, fill_value=0)


def job_title_counts(job_titles: pd.Series) -> pd.Series:
    return job_titles.value_counts().sort_values(ascending=False, kind="stable")


def taxonomy_counts(taxonomy_values: pd.Series) -> pd.Series:
    """Keep the five most common arXiv fields and combine the remainder."""
    counts = taxonomy_values.value_counts().sort_values(
        ascending=False, kind="stable"
    )
    top = counts.iloc[:5].copy()
    remainder = int(counts.iloc[5:].sum())
    if remainder:
        existing_other = [
            label for label in top.index if str(label).strip().lower() == "other"
        ]
        if existing_other:
            top.loc[existing_other[0]] += remainder
        else:
            top.loc["Other"] = remainder
    return top


def preparation_histogram(
    preparation: pd.Series,
) -> tuple[np.ndarray, np.ndarray]:
    values = preparation.to_numpy(dtype=float)
    if not len(values):
        return np.zeros(5, dtype=int), np.linspace(0, 5, 6)
    return np.histogram(values, bins=5)


def _style_axis(ax: plt.Axes) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#D9D9D9", linewidth=0.6, alpha=0.8)
    ax.set_axisbelow(True)


def plot_preparation_time(
    preparation: pd.Series, counts: np.ndarray, edges: np.ndarray
) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(8.0, 5.5))
    widths = np.diff(edges)
    for index, count in enumerate(counts):
        ax.bar(
            edges[index],
            count,
            width=widths[index],
            align="edge",
            color=COLORS[index],
            edgecolor=COLORS[index],
            hatch=HATCHES[index],
            alpha=0.75,
        )
    ax.set_title(f"Preparation time (n={len(preparation)})")
    ax.set_xlabel("Preparation time (minutes)")
    ax.set_ylabel("Participants")
    ax.set_xlim(float(edges[0]), float(edges[-1]))
    ax.set_ylim(0, max(1.0, float(counts.max()) * 1.12))
    _style_axis(ax)
    fig.tight_layout()
    return fig


def _category_bar_or_empty(
    ax: plt.Axes, counts: pd.Series, title: str
) -> None:
    positive = counts.loc[counts.gt(0)]
    if positive.empty:
        ax.text(0.5, 0.5, "No nonmissing data", ha="center", va="center")
        ax.set_axis_off()
        ax.set_title(title)
        return
    positions = np.arange(len(positive))
    bars = ax.barh(
        positions,
        positive.to_numpy(),
        color=[COLORS[index % len(COLORS)] for index in positions],
        edgecolor=[COLORS[index % len(COLORS)] for index in positions],
        alpha=0.75,
    )
    maximum = float(positive.max())
    label_offset = max(0.15, maximum * 0.025)
    for index, bar in enumerate(bars):
        bar.set_hatch(HATCHES[index % len(HATCHES)])
        ax.text(
            float(positive.iloc[index]) + label_offset,
            bar.get_y() + bar.get_height() / 2,
            str(int(positive.iloc[index])),
            ha="left",
            va="center",
            fontsize=8,
        )
    ax.set_yticks(positions)
    ax.set_yticklabels([str(label) for label in positive.index])
    ax.invert_yaxis()
    ax.set_xlim(0, maximum + max(1.0, maximum * 0.16))
    ax.set_xlabel("Participants")
    ax.set_title(title)
    _style_axis(ax)
    ax.grid(False)
    ax.grid(axis="x", color="#D9D9D9", linewidth=0.6, alpha=0.8)


def plot_participant_characteristics(
    publications: pd.Series,
    publication_summary: pd.Series,
    job_titles: pd.Series,
    job_summary: pd.Series,
    taxonomy_values: pd.Series,
    taxonomy_summary: pd.Series,
) -> plt.Figure:
    fig, axes = plt.subplots(1, 3, figsize=(17.0, 6.2))
    _category_bar_or_empty(
        axes[0],
        publication_summary,
        "Published papers",
    )
    _category_bar_or_empty(axes[1], job_summary, "Job title")
    _category_bar_or_empty(axes[2], taxonomy_summary, "arXiv field taxonomy")
    fig.suptitle(
        "Participant characteristics "
        f"(published papers n={len(publications)}; "
        f"job title n={len(job_titles)}; "
        f"arXiv field n={len(taxonomy_values)})"
    )
    fig.tight_layout(rect=(0, 0, 1, 0.94))
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
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
        "–": "--",
    }
    return "".join(
        replacements.get(character, character) for character in str(value)
    )


def _description_command(text: str) -> str:
    return rf"\Description{{{_latex_escape(text)}}}"


def _category_counts_description(name: str, counts: pd.Series) -> str:
    positive = counts.loc[counts.gt(0)]
    if positive.empty:
        return f"{name} has no nonmissing observations."
    entries = "; ".join(
        f"{label}, {int(count)}" for label, count in positive.items()
    )
    return f"{name} counts are: {entries}."


def _color_definitions(count: int) -> list[str]:
    return [
        rf"\definecolor{{demoColor{index}}}{{HTML}}{{{COLORS[index % len(COLORS)][1:]}}}"
        for index in range(count)
    ]


def _pattern_style(index: int) -> str:
    return (
        f"draw=demoColor{index},fill=demoColor{index}!15,"
        f"pattern={TIKZ_PATTERNS[index % len(TIKZ_PATTERNS)]},"
        f"pattern color=demoColor{index}"
    )


def write_preparation_tikz(
    counts: np.ndarray,
    edges: np.ndarray,
    n: int,
    output_path: Path,
) -> None:
    y_max = max(1.0, float(counts.max()) * 1.12)
    bin_description = "; ".join(
        f"{edges[index]:.3g} to {edges[index + 1]:.3g} minutes, "
        f"{int(count)} participants"
        for index, count in enumerate(counts)
    )
    lines = [
        r"\begin{figure}[htbp]",
        r"\centering",
        r"\begin{tikzpicture}",
        *_color_definitions(len(counts)),
        r"\begin{axis}[",
        r"width=0.88\linewidth,height=0.55\linewidth,",
        f"xmin={float(edges[0]):.8g},xmax={float(edges[-1]):.8g},",
        f"ymin=0,ymax={y_max:.8g},",
        r"xlabel={Preparation time (minutes)},",
        r"ylabel={Participants},",
        r"axis lines*=left,ymajorgrids,",
        r"grid style={draw=gray!30,line width=0.4pt},",
        r"]",
    ]
    for index, count in enumerate(counts):
        lines.append(
            rf"\draw[{_pattern_style(index)}] "
            rf"(axis cs:{edges[index]:.8g},0) rectangle "
            rf"(axis cs:{edges[index + 1]:.8g},{int(count)});"
        )
    lines.extend(
        [
            r"\end{axis}",
            r"\end{tikzpicture}",
            rf"\caption{{Preparation time distribution ($n={n}$).}}",
            _description_command(
                "Five-bin histogram of participant preparation time in minutes. "
                f"The bins contain: {bin_description}. "
                "Bars use distinct colors and hatch patterns."
            ),
            r"\label{fig:preparation-time}",
            r"\end{figure}",
            "",
        ]
    )
    output_path.write_text("\n".join(lines), encoding="utf-8")


def _category_bar_tikz_lines(counts: pd.Series) -> list[str]:
    positive = counts.loc[counts.gt(0)]
    if positive.empty:
        return [
            r"\begin{axis}[width=\linewidth,height=4cm,hide axis]",
            r"\node at (axis cs:0,0) {No nonmissing data};",
            r"\end{axis}",
        ]
    maximum = float(positive.max())
    x_max = maximum + max(1.0, maximum * 0.16)
    label_offset = max(0.15, maximum * 0.025)
    positions = list(range(len(positive)))
    y_ticks = ",".join(str(position) for position in positions)
    y_labels = ",".join(
        "{" + _latex_escape(label) + "}" for label in positive.index
    )
    height = max(3.5, 1.2 + 0.62 * len(positive))
    lines = [
        r"\begin{axis}[",
        rf"width=\linewidth,height={height:.3g}cm,",
        f"xmin=0,xmax={x_max:.8g},",
        f"ymin=-0.6,ymax={len(positive) - 0.4:.8g},",
        f"ytick={{{y_ticks}}},",
        f"yticklabels={{{y_labels}}},",
        r"y dir=reverse,",
        r"xlabel={Participants},",
        r"axis lines*=left,xmajorgrids,",
        r"grid style={draw=gray!30,line width=0.4pt},",
        r"clip=false,",
        r"]",
    ]
    for index, count in enumerate(positive):
        lines.append(
            rf"\draw[{_pattern_style(index)}] "
            rf"(axis cs:0,{index - 0.32:.8g}) rectangle "
            rf"(axis cs:{int(count)},{index + 0.32:.8g});"
        )
        lines.append(
            rf"\node[anchor=west,font=\scriptsize] at "
            rf"(axis cs:{float(count) + label_offset:.8g},{index}) "
            rf"{{{int(count)}}};"
        )
    lines.append(r"\end{axis}")
    return lines


def write_characteristics_tikz(
    publication_summary: pd.Series,
    job_summary: pd.Series,
    taxonomy_summary: pd.Series,
    publication_n: int,
    job_n: int,
    taxonomy_n: int,
    output_path: Path,
) -> None:
    publication_positive = publication_summary.loc[publication_summary.gt(0)]
    job_positive = job_summary.loc[job_summary.gt(0)]
    taxonomy_positive = taxonomy_summary.loc[taxonomy_summary.gt(0)]
    plotted_summaries = {
        "published papers": publication_positive,
        "job titles": job_positive,
        "arXiv fields": taxonomy_positive,
    }
    for panel_name, counts in plotted_summaries.items():
        if len(counts) > 6:
            raise ValueError(
                f"The compact participant-characteristics layout supports at "
                f"most 6 {panel_name} categories; found {len(counts)}."
            )
        if not counts.empty and int(counts.max()) > 20:
            raise ValueError(
                f"The compact participant-characteristics layout has a y-axis "
                f"maximum of 20, but {panel_name} includes count "
                f"{int(counts.max())}."
            )
    color_count = max(
        len(publication_positive),
        len(job_positive),
        len(taxonomy_positive),
        1,
    )
    description = (
        "Three side-by-side vertical bar charts summarize participant "
        "characteristics, with rotated category labels on the horizontal axes "
        "and counts printed above the bars. "
        + _category_counts_description(
            "Published-paper range", publication_summary
        )
        + " "
        + _category_counts_description("Job title", job_summary)
        + " "
        + _category_counts_description(
            "arXiv field taxonomy", taxonomy_summary
        )
        + " Bars use distinct colors and hatch patterns."
    )
    lines = [
        "% Required in the preamble:",
        "% \\usepackage{pgfplots}",
        "% \\usetikzlibrary{patterns}",
        "% \\pgfplotsset{compat=1.18}",
        r"\begingroup",
        r"\ifdefined\tikzexternaldisable\tikzexternaldisable\fi",
        *_color_definitions(color_count),
        "",
        "% Reserve space for the left label and gaps between panels.",
        r"\pgfmathsetlengthmacro{\demoWidth}{(\linewidth-1.9cm)/3}",
        r"\pgfmathsetlengthmacro{\demoSecond}{\demoWidth+0.55cm}",
        r"\pgfmathsetlengthmacro{\demoThird}{2*\demoWidth+1.10cm}",
        "",
        r"\pgfplotsset{",
        r"  demographics/.style={",
        r"    scale only axis,",
        r"    width=\demoWidth,",
        r"    height=4.3cm,",
        r"    anchor=south west,",
        r"    xmin=-0.6,xmax=5.6,",
        r"    ymin=0,ymax=20,",
        r"    ytick={0,5,10,15,20},",
        r"    axis lines*=left,",
        r"    ymajorgrids,",
        r"    grid style={draw=gray!30,line width=0.4pt},",
        r"    tick label style={font=\small},",
        r"    xticklabel style={rotate=45,anchor=north east},",
        r"    clip=false",
        r"  }",
        r"}",
        "",
        r"\newcommand{\demoBar}[4]{%",
        r"  \path[",
        r"    draw=#3,",
        r"    fill=#3!15,",
        r"    pattern=#4,",
        r"    pattern color=#3",
        r"  ]",
        r"    (axis cs:{#1-0.32},0)",
        r"    rectangle",
        r"    (axis cs:{#1+0.32},#2);",
        r"  \node[anchor=south,font=\small]",
        r"    at (axis cs:#1,{#2+0.35}) {#2};",
        r"}",
        "",
        r"\begin{tikzpicture}",
    ]

    panel_specs = [
        (
            "demoPapers",
            "(0,0)",
            "Published papers",
            publication_positive,
        ),
        (
            "demoJobs",
            r"(\demoSecond,0)",
            "Job title",
            job_positive,
        ),
        (
            "demoFields",
            r"(\demoThird,0)",
            "arXiv field taxonomy",
            taxonomy_positive,
        ),
    ]
    for panel_name, panel_position, panel_title, counts in panel_specs:
        ticks = ",".join(str(index) for index in range(len(counts)))
        tick_labels = ",".join(
            "{" + _latex_escape(str(label)) + "}" for label in counts.index
        )
        lines.extend(
            [
                "",
                rf"% {panel_title} panel",
                r"\begin{axis}[",
                r"  demographics,",
                rf"  name={panel_name},",
                rf"  at={{{panel_position}}},",
                rf"  xtick={{{ticks}}},",
                rf"  xticklabels={{{tick_labels}}},",
                r"]",
            ]
        )
        for index, count in enumerate(counts):
            lines.append(
                rf"\demoBar{{{index}}}{{{int(count)}}}"
                rf"{{demoColor{index}}}"
                rf"{{{TIKZ_PATTERNS[index % len(TIKZ_PATTERNS)]}}}"
            )
        lines.append(r"\end{axis}")

    lines.extend(
        [
            "",
            "% Panel titles constrained to their respective panel widths.",
        ]
    )
    for panel_name, _, panel_title, _ in panel_specs:
        lines.extend(
            [
                r"\node[",
                r"  anchor=south,",
                r"  font=\small\bfseries,",
                r"  align=center,",
                r"  text width=\demoWidth",
                rf"] at ([yshift=8pt]{panel_name}.north) "
                rf"{{{_latex_escape(panel_title)}}};",
                "",
            ]
        )
    lines.extend(
        [
            "% Explicit placement relative to the left axis origin.",
            r"\node[rotate=90,font=\small] at (-22pt,2.15cm) {Participants};",
            "",
            r"\end{tikzpicture}",
        _description_command(description),
            r"\ifdefined\tikzexternalenable\tikzexternalenable\fi",
            r"\endgroup",
            "",
        ]
    )
    output_path.write_text("\n".join(lines), encoding="utf-8")


def write_summary(
    counts: np.ndarray,
    edges: np.ndarray,
    publication_summary: pd.Series,
    job_summary: pd.Series,
    taxonomy_summary: pd.Series,
    output_path: Path,
) -> None:
    rows: list[dict[str, Any]] = []
    for index, count in enumerate(counts):
        rows.append(
            {
                "variable": "preparation_time",
                "category": f"[{edges[index]:.6g}, {edges[index + 1]:.6g})",
                "count": int(count),
            }
        )
    rows.extend(
        {
            "variable": "published_papers",
            "category": str(label),
            "count": int(count),
        }
        for label, count in publication_summary.items()
    )
    rows.extend(
        {
            "variable": "job_title",
            "category": str(label),
            "count": int(count),
        }
        for label, count in job_summary.items()
    )
    rows.extend(
        {
            "variable": "arxiv_field_taxonomy",
            "category": str(label),
            "count": int(count),
        }
        for label, count in taxonomy_summary.items()
    )
    pd.DataFrame(rows).to_csv(output_path, index=False)


def run_demographic_analysis(
    input_path: Path, taxonomy_input_path: Path, output_dir: Path
) -> None:
    data = _read_input(input_path)
    taxonomy_data = _read_taxonomy_input(taxonomy_input_path)
    data, taxonomy_data = match_interviewed_participants(data, taxonomy_data)
    preparation, publications, job_titles = prepare_demographic_data(data)
    taxonomy_values = taxonomy_data[TAXONOMY_COLUMN].astype(str).str.strip()
    taxonomy_values = taxonomy_values.loc[taxonomy_values.ne("")]
    pub_summary = publication_counts(publications)
    job_summary = job_title_counts(job_titles)
    taxonomy_summary = taxonomy_counts(taxonomy_values)
    prep_counts, prep_edges = preparation_histogram(preparation)

    output_dir.mkdir(parents=True, exist_ok=True)
    plot_preparation_time(preparation, prep_counts, prep_edges).savefig(
        output_dir / "preparation_time_histogram.png",
        dpi=200,
        bbox_inches="tight",
        facecolor="white",
    )
    plt.close("all")
    plot_participant_characteristics(
        publications,
        pub_summary,
        job_titles,
        job_summary,
        taxonomy_values,
        taxonomy_summary,
    ).savefig(
        output_dir / "participant_characteristics.png",
        dpi=200,
        bbox_inches="tight",
        facecolor="white",
    )
    plt.close("all")

    write_preparation_tikz(
        prep_counts,
        prep_edges,
        len(preparation),
        output_dir / "preparation_time_histogram.tex",
    )
    write_characteristics_tikz(
        pub_summary,
        job_summary,
        taxonomy_summary,
        len(publications),
        len(job_titles),
        len(taxonomy_values),
        output_dir / "participant_characteristics.tex",
    )
    write_summary(
        prep_counts,
        prep_edges,
        pub_summary,
        job_summary,
        taxonomy_summary,
        output_dir / "demographic_summary.csv",
    )


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Create aggregate preparation-time, publication-count, and "
            "job-title figures from the participant CSV, plus an arXiv-field "
            "summary from the recruitment CSV."
        )
    )
    parser.add_argument("input", type=Path, help="Private participant CSV or TSV.")
    parser.add_argument(
        "taxonomy_input",
        type=Path,
        help="Private recruitment CSV or TSV containing arXiv Field Taxonomy.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("demographic_output"),
        help="Directory for aggregate PNG, TikZ, and CSV outputs.",
    )
    return parser


def main() -> None:
    parser = build_argument_parser()
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        run_demographic_analysis(
            args.input.resolve(),
            args.taxonomy_input.resolve(),
            args.output_dir.resolve(),
        )
    except (FileNotFoundError, ValueError) as exc:
        parser.error(str(exc))
        return
    LOGGER.info("Demographic outputs written to %s", args.output_dir.resolve())


if __name__ == "__main__":
    main()
