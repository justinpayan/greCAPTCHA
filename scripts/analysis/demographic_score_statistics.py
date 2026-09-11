"""Plot participant-level mean question scores by seniority and paper year."""

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
from matplotlib.patches import Patch

from analyze_tests import TARGET_LABELS, load_question_data


LOGGER = logging.getLogger("demographic_score_statistics")

SENIORITY_ORDER = ("masters", "phd", "postdoc", "professor")
SENIORITY_LABELS = {
    "masters": "Master’s",
    "phd": "PhD",
    "postdoc": "Postdoc",
    "professor": "Professor",
}
YEAR_ORDER = ("through_2023", "2024", "2025", "2026")
YEAR_LABELS = {
    "through_2023": "2023 or earlier",
    "2024": "2024",
    "2025": "2025",
    "2026": "2026",
}
COLORS = ("#0072B2", "#E69F00", "#009E73", "#CC79A7")
HATCHES = ("///", r"\\\\", "xx", "---")
TIKZ_PATTERNS = (
    "north east lines",
    "north west lines",
    "crosshatch",
    "horizontal lines",
)


def _normalize_header(value: Any) -> str:
    return " ".join(str(value).strip().lower().replace("_", " ").split())


def _read_auxiliary_csv(path: Path, name: str) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"{name} file does not exist: {path}")
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
        if len(data.columns) <= 1:
            continue
        data.columns = [_normalize_header(column) for column in data.columns]
        if len(data.columns) != len(set(data.columns)):
            raise ValueError(
                f"{name} contains duplicate columns after normalization."
            )
        return data
    detail = errors[0] if errors else "no delimiter produced multiple columns"
    raise ValueError(f"Could not parse {name} '{path}': {detail}")


def _resolve_column(
    data: pd.DataFrame, aliases: tuple[str, ...], source_name: str
) -> str:
    normalized_aliases = {_normalize_header(alias) for alias in aliases}
    matches = [column for column in data.columns if column in normalized_aliases]
    if not matches and "participant id" in normalized_aliases:
        matches = [
            column
            for column in data.columns
            if column.startswith("participant id")
        ]
    if len(matches) != 1:
        raise ValueError(
            f"{source_name} must contain exactly one of these columns: "
            + ", ".join(aliases)
            + ". Parsed columns were: "
            + ", ".join(data.columns)
        )
    return matches[0]


def _normalized_ids(
    data: pd.DataFrame, column: str, source_name: str
) -> pd.Series:
    ids = data[column].astype(str).str.strip()
    blank = ids.eq("")
    if blank.any():
        rows = (blank[blank].index + 2).tolist()[:8]
        raise ValueError(f"{source_name} has blank participant IDs at rows {rows}.")
    keys = ids.str.casefold()
    duplicate = keys.duplicated(keep=False)
    if duplicate.any():
        values = sorted(ids.loc[duplicate].drop_duplicates().tolist())
        raise ValueError(
            f"{source_name} has duplicate participant IDs: " + ", ".join(values)
        )
    return keys


def _seniority_bin(value: str) -> str | None:
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
        return "postdoc"
    if "professor" in normalized or "faculty" in normalized:
        return "professor"
    if "master" in normalized:
        return "masters"
    if (
        "phd" in normalized.replace(" ", "")
        or "doctoral" in normalized
        or "doctorate" in normalized
    ):
        return "phd"
    return None


def _publication_year(value: str) -> int | None:
    text = value.strip()
    if not text:
        return None
    match = pd.Series([text]).str.extract(r"((?:19|20)\d{2})", expand=False).iloc[0]
    if pd.isna(match):
        return None
    return int(match)


def _year_bin(year: int | None) -> str | None:
    if year is None:
        return None
    if year <= 2023:
        return "through_2023"
    if year in {2024, 2025, 2026}:
        return str(year)
    return None


def build_participant_demographics(
    participants: pd.DataFrame, metadata: pd.DataFrame
) -> pd.DataFrame:
    participant_id_column = _resolve_column(
        participants,
        ("participant_id", "participant id"),
        "participants CSV",
    )
    paper_date_column = _resolve_column(
        participants,
        ("own_paper_date", "own paper date", "paper year", "publication year"),
        "participants CSV",
    )
    metadata_id_column = _resolve_column(
        metadata,
        (
            "participant_id",
            "participant id",
            "Participant ID (links experimental data to participant)",
        ),
        "metadata CSV",
    )
    job_title_column = _resolve_column(
        metadata,
        ("job_title", "job title"),
        "metadata CSV",
    )

    participant_keys = _normalized_ids(
        participants, participant_id_column, "participants CSV"
    )
    metadata_keys = _normalized_ids(metadata, metadata_id_column, "metadata CSV")
    participant_frame = pd.DataFrame(
        {
            "participant_key": participant_keys,
            "participant_id": participants[participant_id_column].astype(str).str.strip(),
            "paper_date": participants[paper_date_column].astype(str).str.strip(),
        }
    )
    metadata_frame = pd.DataFrame(
        {
            "participant_key": metadata_keys,
            "job_title": metadata[job_title_column].astype(str).str.strip(),
        }
    )
    joined = participant_frame.merge(
        metadata_frame, on="participant_key", how="inner", validate="one_to_one"
    )
    missing_metadata = participant_frame.loc[
        ~participant_frame["participant_key"].isin(metadata_frame["participant_key"]),
        "participant_id",
    ].tolist()
    if missing_metadata:
        LOGGER.warning(
            "Excluding participant IDs absent from metadata (%d): %s",
            len(missing_metadata),
            ", ".join(sorted(missing_metadata)),
        )

    joined["seniority_bin"] = joined["job_title"].map(_seniority_bin)
    unknown_titles = sorted(
        joined.loc[
            joined["job_title"].ne("") & joined["seniority_bin"].isna(),
            "job_title",
        ].unique()
    )
    if unknown_titles:
        raise ValueError(
            "Unrecognized nonblank job titles; add a seniority mapping for: "
            + ", ".join(unknown_titles)
        )

    joined["publication_year"] = joined["paper_date"].map(_publication_year)
    invalid_dates = joined[
        joined["paper_date"].ne("") & joined["publication_year"].isna()
    ]
    if not invalid_dates.empty:
        raise ValueError(
            "Could not extract a four-digit publication year for participant IDs: "
            + ", ".join(sorted(invalid_dates["participant_id"].tolist()))
        )
    joined["paper_age_bin"] = joined["publication_year"].map(_year_bin)
    unsupported_years = joined[
        joined["publication_year"].notna() & joined["paper_age_bin"].isna()
    ]
    if not unsupported_years.empty:
        details = ", ".join(
            f"{row.participant_id} ({int(row.publication_year)})"
            for row in unsupported_years.itertuples()
        )
        raise ValueError(
            "Publication years after 2026 are outside the requested bins: "
            + details
        )
    return joined


def build_participant_scores(question_data: pd.DataFrame) -> pd.DataFrame:
    scored = question_data.copy()
    unanswered = scored["skipped"] | scored["timed_out"]
    scored.loc[unanswered, "score"] = 0.0
    scored["participant_key"] = (
        scored["participant_id"].astype(str).str.strip().str.casefold()
    )
    position_one = scored.loc[scored["paper_position"].eq(1)]
    first_order_counts = position_one.groupby("participant_key")[
        "paper_order"
    ].nunique()
    invalid_first_order = first_order_counts[first_order_counts.ne(1)].index.tolist()
    all_participants = set(scored["participant_key"])
    missing_first_order = sorted(
        all_participants - set(first_order_counts.index)
    )
    if invalid_first_order or missing_first_order:
        invalid = sorted(set(invalid_first_order) | set(missing_first_order))
        raise ValueError(
            "Could not determine one position-one paper order for participant IDs: "
            + ", ".join(invalid)
        )
    first_order = (
        position_one.groupby("participant_key", sort=False)["paper_order"]
        .first()
        .to_dict()
    )
    scored["first_paper_order"] = scored["participant_key"].map(first_order)
    scored["paper_familiarity"] = np.where(
        (
            scored["paper_position"].eq(1)
            & scored["first_paper_order"].eq("own")
        )
        | (
            scored["paper_position"].eq(2)
            & scored["first_paper_order"].eq("foreign")
        ),
        "familiar",
        "unfamiliar",
    )

    invalid_tests: list[str] = []
    for (participant_key, paper_position), test in scored.groupby(
        ["participant_key", "paper_position"], sort=True
    ):
        target_counts = test["question_target"].value_counts().to_dict()
        valid = (
            len(test) == 8
            and set(test["position"]) == set(range(1, 9))
            and all(target_counts.get(target, 0) == 2 for target in TARGET_LABELS)
        )
        if not valid:
            invalid_tests.append(f"{participant_key}/position-{paper_position}")
    tests = scored[
        ["participant_key", "paper_position", "paper_familiarity"]
    ].drop_duplicates()
    invalid_pairs: list[str] = []
    for participant_key, participant_tests in tests.groupby(
        "participant_key", sort=True
    ):
        valid = (
            len(participant_tests) == 2
            and set(participant_tests["paper_position"]) == {1, 2}
            and set(participant_tests["paper_familiarity"])
            == {"familiar", "unfamiliar"}
        )
        if not valid:
            invalid_pairs.append(participant_key)
    if invalid_tests or invalid_pairs:
        messages = []
        if invalid_tests:
            messages.append("invalid 8-question tests: " + ", ".join(invalid_tests))
        if invalid_pairs:
            messages.append(
                "participants without one familiar and one unfamiliar test: "
                + ", ".join(invalid_pairs)
            )
        raise ValueError("; ".join(messages))

    return (
        scored.groupby(
            ["participant_key", "paper_familiarity", "question_target"],
            observed=True,
            sort=True,
        )["score"]
        .mean()
        .rename("participant_mean_score")
        .reset_index()
    )


def summarize_dimension(
    scores: pd.DataFrame,
    demographics: pd.DataFrame,
    dimension: str,
    order: tuple[str, ...],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    joined = scores.merge(
        demographics[["participant_key", dimension]],
        on="participant_key",
        how="inner",
        validate="many_to_one",
    )
    joined = joined.loc[joined[dimension].notna()].copy()
    rows: list[dict[str, Any]] = []
    for familiarity in ("familiar", "unfamiliar"):
        for target in TARGET_LABELS:
            for category in order:
                values = joined.loc[
                    joined["paper_familiarity"].eq(familiarity)
                    & joined["question_target"].eq(target)
                    & joined[dimension].eq(category),
                    "participant_mean_score",
                ]
                rows.append(
                    {
                        "dimension": dimension,
                        "paper_familiarity": familiarity,
                        "category": category,
                        "question_target": target,
                        "n_participants": int(len(values)),
                        "mean_score": (
                            float(values.mean()) if not values.empty else np.nan
                        ),
                        "standard_deviation": (
                            float(values.std(ddof=1))
                            if len(values) > 1
                            else np.nan
                        ),
                    }
                )
    return joined, pd.DataFrame(rows)


def _score_ymax(summary: pd.DataFrame) -> float:
    values = summary["mean_score"].dropna()
    if values.empty:
        return 5.0
    padded = float(values.max()) + 5.0
    return min(100.0, max(5.0, 5.0 * float(np.ceil(padded / 5.0))))


def plot_score_bars(
    summary: pd.DataFrame,
    order: tuple[str, ...],
    labels: dict[str, str],
    title: str,
) -> plt.Figure:
    fig, axes = plt.subplots(1, 2, figsize=(18.0, 6.5), sharey=True)
    width = 0.18
    offsets = np.linspace(-0.3, 0.3, len(order))
    y_max = _score_ymax(summary)
    for ax, familiarity in zip(
        axes, ("familiar", "unfamiliar"), strict=True
    ):
        for target_index, target in enumerate(TARGET_LABELS):
            for category_index, category in enumerate(order):
                row = summary.loc[
                    summary["paper_familiarity"].eq(familiarity)
                    & summary["question_target"].eq(target)
                    & summary["category"].eq(category)
                ].iloc[0]
                x_position = target_index + offsets[category_index]
                mean = row["mean_score"]
                height = 0.0 if pd.isna(mean) else float(mean)
                ax.bar(
                    x_position,
                    height,
                    width=width,
                    color=COLORS[category_index],
                    edgecolor=COLORS[category_index],
                    hatch=HATCHES[category_index],
                    alpha=0.75,
                )
                ax.text(
                    x_position,
                    1.01,
                    f"n={int(row['n_participants'])}",
                    transform=ax.get_xaxis_transform(),
                    ha="center",
                    va="bottom",
                    fontsize=7,
                    color=COLORS[category_index],
                    clip_on=False,
                )
        ax.set_title(
            "Familiar (own) paper"
            if familiarity == "familiar"
            else "Unfamiliar (foreign) paper",
            pad=25,
        )
        ax.set_xticks(range(len(TARGET_LABELS)))
        ax.set_xticklabels(TARGET_LABELS.values())
        ax.set_xlim(-0.6, len(TARGET_LABELS) - 0.4)
        ax.set_ylim(0, y_max)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.grid(axis="y", color="#D9D9D9", linewidth=0.6, alpha=0.8)
        ax.set_axisbelow(True)
    axes[0].set_ylabel("Average score")
    fig.suptitle(title)
    fig.legend(
        handles=[
            Patch(
                facecolor=COLORS[index],
                edgecolor=COLORS[index],
                hatch=HATCHES[index],
                alpha=0.75,
                label=labels[category],
            )
            for index, category in enumerate(order)
        ],
        loc="upper center",
        bbox_to_anchor=(0.5, 0.02),
        ncol=len(order),
        frameon=False,
    )
    fig.tight_layout(rect=(0, 0.08, 1, 0.92))
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


def _tikz_color_definitions(order: tuple[str, ...]) -> list[str]:
    return [
        rf"\definecolor{{groupColor{index}}}{{HTML}}{{{COLORS[index][1:]}}}"
        for index in range(len(order))
    ]


def _tikz_description(
    summary: pd.DataFrame, labels: dict[str, str], title: str
) -> str:
    entries: list[str] = []
    for row in summary.itertuples():
        if pd.notna(row.mean_score):
            entries.append(
                f"{row.paper_familiarity} paper, "
                f"{TARGET_LABELS[row.question_target]}, "
                f"{labels[row.category]}: mean {row.mean_score:.1f}, "
                f"{row.n_participants} participants"
            )
    details = "; ".join(entries) if entries else "No eligible scores are available"
    text = (
        f"Two-panel grouped bar chart titled {title}. One panel shows familiar "
        "own-paper tests and the other shows unfamiliar foreign-paper tests. "
        "Each panel contains four question types, with one color-and-pattern "
        "bar per demographic category. Skipped and timed-out questions count "
        "as score zero. Text above each bar gives its participant sample size. "
        f"{details}."
    )
    return rf"\Description{{{_latex_escape(text)}}}"


def write_score_tikz(
    summary: pd.DataFrame,
    order: tuple[str, ...],
    labels: dict[str, str],
    title: str,
    output_path: Path,
) -> None:
    width = 0.18
    offsets = np.linspace(-0.3, 0.3, len(order))
    x_min, x_max = -0.6, len(TARGET_LABELS) - 0.4
    y_max = _score_ymax(summary)
    target_ticks = ",".join(str(index) for index in range(len(TARGET_LABELS)))
    target_labels = ",".join(
        "{" + _latex_escape(label) + "}" for label in TARGET_LABELS.values()
    )
    lines = [
        r"\begin{tikzpicture}",
        *_tikz_color_definitions(order),
        r"\begin{groupplot}[",
        r"group style={group size=2 by 1,horizontal sep=1.0cm},",
        r"width=0.46\linewidth,height=0.48\linewidth,",
        f"xmin={x_min},xmax={x_max},ymin=0,ymax={y_max:.8g},",
        f"xtick={{{target_ticks}}},",
        f"xticklabels={{{target_labels}}},",
        r"axis lines*=left,ymajorgrids,clip=false,",
        r"grid style={draw=gray!30,line width=0.4pt},",
        r"]",
    ]
    for familiarity_index, familiarity in enumerate(
        ("familiar", "unfamiliar")
    ):
        panel_title = (
            "Familiar (own) paper"
            if familiarity == "familiar"
            else "Unfamiliar (foreign) paper"
        )
        axis_options = [
            f"title={{{panel_title}}}",
            "title style={align=center,yshift=2.2em}",
        ]
        if familiarity_index == 0:
            axis_options.extend(
                [
                    "ylabel={Average score}",
                    (
                        "legend style={at={(1.08,-0.18)},anchor=north,"
                        f"draw=none,legend columns={len(order)}}}"
                    ),
                ]
            )
        lines.append(r"\nextgroupplot[" + ",".join(axis_options) + "]")
        for target_index, target in enumerate(TARGET_LABELS):
            for category_index, category in enumerate(order):
                row = summary.loc[
                    summary["paper_familiarity"].eq(familiarity)
                    & summary["question_target"].eq(target)
                    & summary["category"].eq(category)
                ].iloc[0]
                x_position = target_index + offsets[category_index]
                mean = row["mean_score"]
                height = 0.0 if pd.isna(mean) else float(mean)
                half_width = width / 2.0
                lines.append(
                    rf"\draw[draw=groupColor{category_index},"
                    rf"fill=groupColor{category_index}!15,"
                    rf"pattern={TIKZ_PATTERNS[category_index]},"
                    rf"pattern color=groupColor{category_index}] "
                    rf"(axis cs:{x_position - half_width:.8g},0) rectangle "
                    rf"(axis cs:{x_position + half_width:.8g},{height:.8g});"
                )
                normalized_x = (x_position - x_min) / (x_max - x_min)
                lines.append(
                    rf"\node[anchor=south,font=\scriptsize,"
                    rf"text=groupColor{category_index}] at "
                    rf"(rel axis cs:{normalized_x:.8g},1.01) "
                    rf"{{n={int(row['n_participants'])}}};"
                )
        if familiarity_index == 0:
            for category_index, category in enumerate(order):
                lines.extend(
                    [
                        (
                            rf"\addlegendimage{{legend image code/.code={{"
                            rf"\draw[draw=groupColor{category_index},"
                            rf"fill=groupColor{category_index}!15,"
                            rf"pattern={TIKZ_PATTERNS[category_index]},"
                            rf"pattern color=groupColor{category_index}] "
                            rf"(0cm,-0.08cm) rectangle (0.34cm,0.08cm);}}}}"
                        ),
                        rf"\addlegendentry{{{_latex_escape(labels[category])}}}",
                    ]
                )
    lines.extend(
        [
            r"\end{groupplot}",
            (
                r"\node[font=\bfseries,anchor=south] at "
                rf"([yshift=0.9cm]group c1r1.north east) {{{_latex_escape(title)}}};"
            ),
            r"\end{tikzpicture}",
            _tikz_description(summary, labels, title),
            "",
        ]
    )
    output_path.write_text("\n".join(lines), encoding="utf-8")


def run_analysis(
    scores_path: Path,
    participants_path: Path,
    metadata_path: Path,
    output_dir: Path,
) -> None:
    question_data = load_question_data(scores_path)
    participants = _read_auxiliary_csv(participants_path, "participants CSV")
    metadata = _read_auxiliary_csv(metadata_path, "metadata CSV")
    demographics = build_participant_demographics(participants, metadata)
    scores = build_participant_scores(question_data)

    answer_keys = set(scores["participant_key"])
    demographic_keys = set(demographics["participant_key"])
    missing_demographics = sorted(answer_keys - demographic_keys)
    if missing_demographics:
        LOGGER.warning(
            "Answer data contains IDs without matched demographics (%d): %s",
            len(missing_demographics),
            ", ".join(missing_demographics),
        )

    _, seniority_summary = summarize_dimension(
        scores, demographics, "seniority_bin", SENIORITY_ORDER
    )
    _, year_summary = summarize_dimension(
        scores, demographics, "paper_age_bin", YEAR_ORDER
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    combined_summary = pd.concat(
        [seniority_summary, year_summary], ignore_index=True
    )
    combined_summary.to_csv(
        output_dir / "demographic_score_summary.csv", index=False
    )

    figures = (
        (
            "score_by_seniority",
            seniority_summary,
            SENIORITY_ORDER,
            SENIORITY_LABELS,
            "Average score by seniority",
        ),
        (
            "score_by_paper_age",
            year_summary,
            YEAR_ORDER,
            YEAR_LABELS,
            "Average score by paper publication year",
        ),
    )
    for filename, summary, order, labels, title in figures:
        figure = plot_score_bars(summary, order, labels, title)
        figure.savefig(
            output_dir / f"{filename}.png",
            dpi=200,
            bbox_inches="tight",
            facecolor="white",
        )
        plt.close(figure)
        write_score_tikz(
            summary, order, labels, title, output_dir / f"{filename}.tex"
        )


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Plot participant-level mean question scores by job-title "
            "seniority and own-paper publication year."
        )
    )
    parser.add_argument("scores", type=Path, help="Answer-level CSV or TSV.")
    parser.add_argument(
        "participants",
        type=Path,
        help="Participants CSV containing participant ID and own-paper date.",
    )
    parser.add_argument(
        "metadata",
        type=Path,
        help="Metadata CSV containing participant ID and job title.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("demographic_score_output"),
        help="Directory for aggregate CSV, PNG, and TikZ outputs.",
    )
    return parser


def main() -> None:
    parser = build_argument_parser()
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    try:
        run_analysis(
            args.scores.resolve(),
            args.participants.resolve(),
            args.metadata.resolve(),
            args.output_dir.resolve(),
        )
    except (FileNotFoundError, ValueError) as exc:
        parser.error(str(exc))
        return
    LOGGER.info("Demographic score outputs written to %s", args.output_dir.resolve())


if __name__ == "__main__":
    main()
