import pandas as pd

fields_renamer = {
    "condition": "paper_order",
    "block_position": "paper_position",
    "foreign_stratum": "field_type",
    "block_name": "question_target",
}

fields_to_keep = {
    "participant_id",
    "paper_order",
    "paper_position",
    "field_type",
    "attempt_score",
    "attempt_created_at",
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
    "grader_feedback"
}

data = pd.read_csv("scripts/answers.csv", header=0)
data = data.rename(columns=fields_renamer)
data_cols = data.columns.tolist()
remain_cols = set(data_cols).intersection(fields_to_keep)

ordered_columns = [col for col in data_cols if col in remain_cols]
data = data[ordered_columns]
data["field_type"] = data["field_type"].str.replace("out_of_field", "out_field", regex=False)
data.to_csv("scripts/answers_cleaned.csv", index=False)