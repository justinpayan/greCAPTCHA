"use client";

import { useState } from "react";

import { MathText } from "@/components/quiz/math-text";
import type { QuestionSetOverview } from "@/lib/quiz";

const TYPE_LABELS = {
  fill_blank: "Fill in the blank",
  multiple_choice: "Multiple choice",
  free_response: "Free response",
} as const;

function formatLimit(seconds: number | null) {
  if (seconds === null) return "untimed";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * A saved set's contents, readable without spending an attempt on it.
 *
 * Researcher-facing: it names each card and what each item probes, so it must not be on screen
 * while a participant is working. The rename lives here rather than as an inline edit in the list,
 * so renaming a set and seeing what is in it are the same act.
 */
/** Whole minutes in the field, seconds in the data. Empty means no overall limit. */
function limitToMinutes(seconds: number | null) {
  return seconds === null ? "" : String(Math.round(seconds / 60));
}

export function SetOverview({
  overview,
  onSaved,
  onBack,
}: {
  overview: QuestionSetOverview;
  onSaved: (patch: { name: string; overallTimeLimitSeconds: number | null }) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(overview.name);
  const [limitMinutes, setLimitMinutes] = useState(limitToMinutes(overview.overallTimeLimitSeconds));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const warmups = overview.items.filter((item) => item.warmup).length;
  const savedMinutes = limitToMinutes(overview.overallTimeLimitSeconds);
  const nameChanged = name !== overview.name;
  const limitChanged = limitMinutes.trim() !== savedMinutes;
  const nextLimitSeconds = limitMinutes.trim() ? Number(limitMinutes) * 60 : null;
  const changed = nameChanged || limitChanged;

  /** Sends only the fields that changed, so saving one cannot clear the other. */
  async function save() {
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const body: { name?: string; overallTimeLimitSeconds?: number | null } = {};
      if (nameChanged) body.name = name;
      if (limitChanged) body.overallTimeLimitSeconds = nextLimitSeconds;

      const response = await fetch(`/api/question-sets/${encodeURIComponent(overview.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update the set.");

      const savedName = nameChanged ? (payload.name as string) : overview.name;
      const savedLimit = limitChanged
        ? (payload.overallTimeLimitSeconds as number | null)
        : overview.overallTimeLimitSeconds;
      onSaved({ name: savedName, overallTimeLimitSeconds: savedLimit });

      const notes: string[] = [];
      if (nameChanged) {
        notes.push(savedName ? "Name saved." : "Name cleared — the PDF filename is used instead.");
      }
      if (limitChanged) {
        notes.push(
          savedLimit === null
            ? "Overall limit removed."
            : `Overall limit set to ${Math.round(savedLimit / 60)} minutes.`,
        );
        // Said out loud, because the rule is not guessable: an attempt already under way keeps
        // the budget it was created with.
        const touched = (payload.attemptsUpdated as number) ?? 0;
        notes.push(
          touched === 0
            ? "No unstarted attempt on this set needed updating."
            : `Also applied to ${touched} attempt${touched === 1 ? "" : "s"} that ${
                touched === 1 ? "has" : "have"
              } not started.`,
        );
      }
      setStatus(notes.join(" "));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the set.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>

      <header className="quiz-header sequential-header">
        <div>
          <p className="eyebrow">Question set</p>
          <h1>{name.trim() || overview.paperName}</h1>
          <div className="quiz-meta">
            {overview.paperName} · {overview.modelId} · {overview.pdfEngine}
          </div>
        </div>
        <div className="summary-header-side">
          <div className="sequence-status">
            <div className="sequence-progress">
              {overview.items.length}{" "}
              {overview.items.length === 1 ? "question" : "questions"}
            </div>
            <div className="question-timer">
              {overview.items.length - warmups} scored · {warmups} warm-up
            </div>
          </div>
        </div>
      </header>

      <p className="lede summary-notice">
        This page is for the researcher. It names each card and what each item probes, so do not
        leave it on screen once an assessment is handed over.
      </p>

      <section className="card participant-link">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="setName">Set name</label>
            <input
              className="control"
              id="setName"
              value={name}
              maxLength={120}
              placeholder={overview.paperName}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && changed) void save();
              }}
            />
            <small>
              Blank falls back to the PDF filename. Renaming touches nothing else — the questions,
              the {overview.attemptCount}{" "}
              {overview.attemptCount === 1 ? "attempt" : "attempts"} on this set and their answers
              are unaffected.
            </small>
          </div>

          <div className="field">
            <label htmlFor="setLimit">
              Overall time limit
              <span className="label-note">minutes</span>
            </label>
            <input
              className="control"
              id="setLimit"
              type="number"
              min={1}
              max={360}
              step={1}
              value={limitMinutes}
              placeholder="No limit"
              onChange={(event) => setLimitMinutes(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && changed) void save();
              }}
            />
            <small>
              Enforced: once spent, no further question is served. Changing it also updates attempts
              on this set that have not started; one already under way keeps the budget it began
              with.
            </small>
          </div>
        </div>

        <div className="set-save-row">
          <button
            className="primary"
            type="button"
            disabled={saving || !changed}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      <div className="set-facts">
        <span>
          Overall limit: <strong>{formatLimit(overview.overallTimeLimitSeconds)}</strong>
        </span>
        <span>
          Attempts: <strong>{overview.attemptCount}</strong>
        </span>
        <span>
          Experiments: <strong>{overview.experimentCount}</strong>
        </span>
        <span>
          Generated: <strong>{new Date(overview.createdAt).toLocaleString()}</strong>
        </span>
      </div>

      <section className="summary-list">
        {overview.items.map((item) => (
          <article className={`card summary-item type-${item.type}`} key={item.questionId}>
            <div className="summary-item-head">
              <span className="summary-position">{item.position}</span>
              <span className={`type-chip type-${item.type}`}>{TYPE_LABELS[item.type]}</span>
              {item.blockName && <span className="summary-block">{item.blockName}</span>}
              {item.warmup && <span className="pill">Warm-up</span>}
              <span className="summary-limit">{formatLimit(item.timeLimitSeconds)}</span>
            </div>
            <p className="summary-description">
              {item.description ? (
                <MathText text={item.description} />
              ) : (
                "No description was generated for this item."
              )}
            </p>
          </article>
        ))}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="template-status">{status}</p>}

      <div className="quiz-actions sequential-actions">
        <span className="hint">
          Stored order. Warm-ups move to the front when an attempt is created, and the rest are
          shuffled if that attempt randomizes them.
        </span>
        <button className="secondary" type="button" onClick={onBack}>
          Back to dashboard
        </button>
      </div>
    </main>
  );
}
