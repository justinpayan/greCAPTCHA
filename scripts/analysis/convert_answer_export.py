"""Convert a current ResearchCAPTCHA answer export to the legacy analysis schema."""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

import pandas as pd


SOURCE_COLUMNS = {
    "participant_id",
    "condition",
    "block_position",
    "foreign_stratum",
    "attempt_score",
    "attempt_completed_at",
    "position",
    "block_name",
    "question_type",
    "warmup",
    "started_at",
    "first_interaction_at",
    "first_interaction_ms",
    "submitted_at",
    "duration_ms",
    "score",
    "skipped",
    "timed_out",
    "response",
    "correct_answer",
    "correct",
    "grader_feedback",
}
OUTPUT_COLUMNS = (
    "participant_id",
    "paper_order",
    "paper_position",
    "field_type",
    "attempt_score",
    "attempt_completed_at",
    "position",
    "question_target",
    "question_type",
    "started_at",
    "first_interaction_at",
    "first_interaction_ms",
    "submitted_at",
    "duration_ms",
    "score",
    "skipped",
    "timed_out",
    "response",
    "correct_answer",
    "correct",
    "grader_feedback",
)
TARGET_PATTERNS = (
    ("planted error", "Planted error"),
    ("unstated rationale", "Unstated rationale"),
    ("background knowledge", "Background knowledge"),
    ("background knowledgde", "Background knowledge"),
    ("background knowlegde", "Background knowledge"),
    ("failure mode", "Failure mode"),
)
TRUE_VALUES = {"true", "1", "yes"}
FALSE_VALUES = {"false", "0", "no", ""}


def read_source(path: Path) -> pd.DataFrame:
    if not path.is_file():
        raise FileNotFoundError(f"Source answer export not found: {path}.")
    try:
        frame = pd.read_csv(
            path,
            dtype="string",
            keep_default_na=False,
        )
    except pd.errors.EmptyDataError as exc:
        raise ValueError(f"Source answer export is empty: {path}.") from exc
    except pd.errors.ParserError as exc:
        raise ValueError(f"Could not parse {path}: {exc}") from exc
    missing = sorted(SOURCE_COLUMNS - set(frame.columns))
    if missing:
        raise ValueError(
            f"{path} is missing required column(s): {', '.join(missing)}."
        )
    return frame


def parse_boolean(values: pd.Series, column: str) -> pd.Series:
    normalized = values.astype("string").str.strip().str.lower()
    invalid = ~normalized.isin(TRUE_VALUES | FALSE_VALUES)
    if invalid.any():
        examples = ", ".join(
            normalized.loc[invalid].drop_duplicates().head(5)
        )
        raise ValueError(
            f"Column {column!r} contains unrecognized boolean values: {examples}."
        )
    return normalized.isin(TRUE_VALUES)


def canonical_question_targets(block_names: pd.Series) -> pd.Series:
    normalized = block_names.astype("string").str.strip().str.lower()
    output = pd.Series(pd.NA, index=block_names.index, dtype="string")
    for pattern, canonical in TARGET_PATTERNS:
        matches = output.isna() & normalized.str.contains(
            pattern,
            regex=False,
            na=False,
        )
        output.loc[matches] = canonical
    missing = output.isna()
    if missing.any():
        examples = ", ".join(
            block_names.loc[missing].astype("string").drop_duplicates().head(5)
        )
        raise ValueError(
            "Could not derive question_target from block_name value(s): "
            f"{examples}."
        )
    return output


def convert(frame: pd.DataFrame) -> pd.DataFrame:
    participant_ids = frame["participant_id"].astype("string").str.strip()
    experiment_rows = participant_ids.ne("")
    excluded_standalone = int((~experiment_rows).sum())
    frame = frame.loc[experiment_rows].copy()
    if frame.empty:
        raise ValueError("The export contains no experiment rows with participant IDs.")

    warmup = parse_boolean(frame["warmup"], "warmup")
    excluded_warmups = int(warmup.sum())
    frame = frame.loc[~warmup].copy()
    if frame.empty:
        raise ValueError("The export contains no non-warmup experiment rows.")

    conditions = frame["condition"].astype("string").str.strip().str.lower()
    invalid_conditions = ~conditions.isin({"own", "foreign"})
    if invalid_conditions.any():
        examples = ", ".join(
            conditions.loc[invalid_conditions].drop_duplicates().head(5)
        )
        raise ValueError(
            f"condition must contain only own or foreign; found: {examples}."
        )

    paper_positions = pd.to_numeric(frame["block_position"], errors="coerce")
    invalid_positions = (
        paper_positions.isna()
        | paper_positions.mod(1).ne(0)
        | ~paper_positions.isin({1, 2})
    )
    if invalid_positions.any():
        examples = ", ".join(
            frame.loc[invalid_positions, "block_position"]
            .drop_duplicates()
            .head(5)
        )
        raise ValueError(
            f"block_position must contain only 1 or 2; found: {examples}."
        )

    field_type = (
        frame["foreign_stratum"]
        .astype("string")
        .str.strip()
        .str.lower()
        .replace({"out_of_field": "out_field"})
    )
    invalid_fields = ~field_type.isin({"in_field", "out_field"})
    if invalid_fields.any():
        examples = ", ".join(
            field_type.loc[invalid_fields].drop_duplicates().head(5)
        )
        raise ValueError(
            "foreign_stratum must contain in_field, out_field, or "
            f"out_of_field; found: {examples}."
        )

    output = pd.DataFrame(index=frame.index)
    output["participant_id"] = frame["participant_id"].str.strip()
    output["paper_order"] = conditions
    output["paper_position"] = paper_positions.astype(int)
    output["field_type"] = field_type
    output["attempt_score"] = frame["attempt_score"]
    output["attempt_completed_at"] = frame["attempt_completed_at"]
    output["position"] = frame["position"]
    output["question_target"] = canonical_question_targets(frame["block_name"])
    for column in OUTPUT_COLUMNS[8:]:
        output[column] = frame[column]

    test_sizes = output.groupby(
        ["participant_id", "paper_position"],
        dropna=False,
    ).size()
    invalid_test_sizes = test_sizes.ne(8)
    if invalid_test_sizes.any():
        examples = "; ".join(
            f"{participant}/{position}: {count} rows"
            for (participant, position), count in test_sizes.loc[
                invalid_test_sizes
            ].head(5).items()
        )
        raise ValueError(
            "Converted experiment tests must contain exactly eight rows; "
            f"invalid test(s): {examples}."
        )
    if excluded_standalone:
        print(f"Excluded {excluded_standalone} standalone answer row(s).")
    if excluded_warmups:
        print(f"Excluded {excluded_warmups} warm-up answer row(s).")
    return output.loc[:, OUTPUT_COLUMNS].reset_index(drop=True)


def write_output(frame: pd.DataFrame, path: Path, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise FileExistsError(
            f"Output already exists: {path}. Use --overwrite to replace it."
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.stem}_",
        suffix=".csv",
        dir=path.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        frame.to_csv(temporary_path, index=False, lineterminator="\n")
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Convert the current ResearchCAPTCHA answer export to the "
            "full_data_answers.csv analysis schema."
        )
    )
    parser.add_argument(
        "input",
        type=Path,
        nargs="?",
        default=Path("research-captcha-answers-2026-09-10.csv"),
        help=(
            "Current answer export (default: "
            "research-captcha-answers-2026-09-10.csv)."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("full_data_answers.csv"),
        help="Converted CSV path (default: full_data_answers.csv).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing output file.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        converted = convert(read_source(args.input.resolve()))
        write_output(converted, args.output.resolve(), args.overwrite)
        print(f"Wrote {len(converted)} rows to {args.output.resolve()}.")
    except (FileNotFoundError, OSError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
