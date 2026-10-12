"use client";

import { useState } from "react";

import { fixedRubricProblems, levelPoints, type FixedRubric } from "@/lib/quiz";

/** A new rubric: the Full/Half/None levels the default rubrics use, and one criterion to fill in. */
export function starterFixedRubric(): FixedRubric {
  return {
    summary: "",
    levels: [
      { label: "Full", percent: 100 },
      { label: "Half", percent: 50 },
      { label: "None", percent: 0 },
    ],
    criteria: [{ criterion: "", description: "", points: 100, descriptions: ["", "", ""] }],
    gradingNote: "",
  };
}

/** A criterion as one block of text: its name, then any description kept separately. */
function criterionText(criterion: FixedRubric["criteria"][number]): string {
  return [criterion.criterion, criterion.description].filter((part) => part.trim()).join(" ");
}

/**
 * A number input that keeps what is typed, so clearing it to retype does not snap to 0. The value
 * is reported as a number on every change, and the text tidied when the field is left.
 */
function NumberCell({
  value,
  onChange,
  label,
  max = 100,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  max?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="control rubric-number"
      type="number"
      min={0}
      max={max}
      step="any"
      aria-label={label}
      value={text ?? String(value)}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number(event.target.value);
        onChange(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), max) : 0);
      }}
      onBlur={() => setText(null)}
    />
  );
}

/**
 * Edits a card's fixed rubric as the table it is designed as: criteria are rows, levels are
 * columns, and each cell describes one criterion at one level. Problems are listed beneath rather
 * than blocking edits, so an unfinished rubric still autosaves.
 */
export function FixedRubricEditor({
  id,
  rubric,
  onChange,
}: {
  id: string;
  rubric: FixedRubric;
  onChange: (rubric: FixedRubric) => void;
}) {
  const total = rubric.criteria.reduce((sum, criterion) => sum + criterion.points, 0);
  const problems = fixedRubricProblems(rubric);

  function updateLevel(index: number, patch: Partial<FixedRubric["levels"][number]>) {
    onChange({
      ...rubric,
      levels: rubric.levels.map((level, at) => (at === index ? { ...level, ...patch } : level)),
    });
  }

  function updateCriterion(index: number, patch: Partial<FixedRubric["criteria"][number]>) {
    onChange({
      ...rubric,
      criteria: rubric.criteria.map((criterion, at) =>
        at === index ? { ...criterion, ...patch } : criterion,
      ),
    });
  }

  /** A new column just above the lowest level, halfway between it and the next one up. */
  function addLevel() {
    const lowest = rubric.levels.reduce(
      (best, level, index) => (level.percent < rubric.levels[best].percent ? index : best),
      0,
    );
    const above = Math.min(
      ...rubric.levels.map((level) => level.percent).filter((percent) => percent > rubric.levels[lowest].percent),
      100,
    );
    const percent = Math.round((rubric.levels[lowest].percent + above) / 2);
    onChange({
      ...rubric,
      levels: [
        ...rubric.levels.slice(0, lowest),
        { label: "", percent },
        ...rubric.levels.slice(lowest),
      ],
      criteria: rubric.criteria.map((criterion) => ({
        ...criterion,
        descriptions: [
          ...criterion.descriptions.slice(0, lowest),
          "",
          ...criterion.descriptions.slice(lowest),
        ],
      })),
    });
  }

  function removeLevel(index: number) {
    onChange({
      ...rubric,
      levels: rubric.levels.filter((_, at) => at !== index),
      criteria: rubric.criteria.map((criterion) => ({
        ...criterion,
        descriptions: criterion.descriptions.filter((_, at) => at !== index),
      })),
    });
  }

  function addCriterion() {
    onChange({
      ...rubric,
      criteria: [
        ...rubric.criteria,
        {
          criterion: "",
          description: "",
          points: Math.max(0, 100 - total),
          descriptions: rubric.levels.map(() => ""),
        },
      ],
    });
  }

  return (
    <div className="fixed-rubric-editor">
      <div className="field">
        <label htmlFor={`${id}-summary`}>Rubric summary</label>
        <textarea
          className="control"
          id={`${id}-summary`}
          rows={3}
          value={rubric.summary}
          placeholder="Shown to the participant with every question from this card, so they know how their answer is graded."
          onChange={(event) => onChange({ ...rubric, summary: event.target.value })}
        />
      </div>

      <div className="rubric-table-scroll">
        <table className="rubric-table">
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">Points</th>
              {rubric.levels.map((level, index) => (
                <th scope="col" key={index}>
                  <div className="rubric-level-head">
                    <input
                      className="control"
                      aria-label={`Name of level ${index + 1}`}
                      placeholder="Level name"
                      value={level.label}
                      onChange={(event) => updateLevel(index, { label: event.target.value })}
                    />
                    {rubric.levels.length > 1 && (
                      <button
                        className="rubric-remove"
                        type="button"
                        aria-label={`Remove the ${level.label || `level ${index + 1}`} column`}
                        title="Remove this level"
                        onClick={() => removeLevel(index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <label className="rubric-share">
                    <NumberCell
                      value={level.percent}
                      label={`Share of points for level ${index + 1}, in percent`}
                      onChange={(percent) => updateLevel(index, { percent })}
                    />
                    % of points
                  </label>
                </th>
              ))}
              <th scope="col" className="rubric-actions">
                <button className="secondary rubric-add" type="button" onClick={addLevel}>
                  + Level
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rubric.criteria.map((criterion, row) => {
              const points = levelPoints(rubric, criterion.points);
              return (
                <tr key={row}>
                  <td>
                    {/* One box for the criterion and what it assesses; a description kept
                        separately by an older rubric is folded into it on the first edit. */}
                    <textarea
                      className="control"
                      aria-label={`Criterion ${row + 1}`}
                      placeholder="The criterion and what it assesses"
                      rows={5}
                      value={criterionText(criterion)}
                      onChange={(event) =>
                        updateCriterion(row, { criterion: event.target.value, description: "" })
                      }
                    />
                  </td>
                  <td>
                    <NumberCell
                      value={criterion.points}
                      label={`Points for criterion ${row + 1}`}
                      onChange={(value) => updateCriterion(row, { points: value })}
                    />
                  </td>
                  {rubric.levels.map((level, column) => (
                    <td key={column}>
                      <textarea
                        className="control"
                        aria-label={`Criterion ${row + 1} at level ${level.label || column + 1}`}
                        rows={4}
                        value={criterion.descriptions[column] ?? ""}
                        onChange={(event) =>
                          updateCriterion(row, {
                            descriptions: rubric.levels.map((_, at) =>
                              at === column
                                ? event.target.value
                                : (criterion.descriptions[at] ?? ""),
                            ),
                          })
                        }
                      />
                      <small>{points[column]} points</small>
                    </td>
                  ))}
                  <td className="rubric-actions">
                    {rubric.criteria.length > 1 && (
                      <button
                        className="rubric-remove"
                        type="button"
                        aria-label={`Remove criterion ${row + 1}`}
                        title="Remove this criterion"
                        onClick={() =>
                          onChange({
                            ...rubric,
                            criteria: rubric.criteria.filter((_, at) => at !== row),
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <button className="secondary rubric-add" type="button" onClick={addCriterion}>
                  + Criterion
                </button>
              </td>
              <td className={total === 100 ? "rubric-total" : "rubric-total rubric-total-off"}>
                {total} / 100
              </td>
              <td colSpan={rubric.levels.length + 1} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="field">
        <label htmlFor={`${id}-note`}>Rule across criteria (optional)</label>
        <textarea
          className="control"
          id={`${id}-note`}
          rows={2}
          value={rubric.gradingNote}
          placeholder="Applied by the grader across all of this rubric's criteria."
          onChange={(event) => onChange({ ...rubric, gradingNote: event.target.value })}
        />
      </div>

      {problems.length > 0 && (
        <ul className="rubric-problems" role="status">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
