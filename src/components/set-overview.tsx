"use client";

import { useState } from "react";
import { flushSync } from "react-dom";

import { Brand } from "@/components/brand";
import { PrintableQuestionSet } from "@/components/printable-question-set";
import { TakerAllowlistField } from "@/components/taker-allowlist-field";
import { WorkflowTag } from "@/components/workflow-tag";
import { MathText } from "@/components/quiz/math-text";
import { formatAllowlist } from "@/lib/allowlist";
import type { QuestionSetOverview, StoredQuestion } from "@/lib/quiz";
import { userFacingMessage } from "@/lib/user-facing-error";

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
 * The generated content of one item: its full text, and whatever stands as its answer key.
 *
 * Shown only when the researcher expands the item. This is the view the §8.4 bank check needs —
 * reading a set the night before means reading the keys, the distractors and the rubrics, not just
 * the one-line descriptions.
 */
function ItemDetail({ question }: { question: StoredQuestion }) {
  if (question.type === "fill_blank") {
    const answered = new Set(question.blanks.map((blank) => blank.correctChoiceId));
    const answerFor = new Map(question.blanks.map((blank) => [blank.id, blank.answer]));
    return (
      <div className="item-detail">
        <p className="item-text">
          {question.segments.map((segment, index) =>
            segment.type === "text" ? (
              <MathText key={`${index}-text`} text={segment.value} />
            ) : (
              // The answer sits in the gap it belongs to, so the sentence reads as a whole rather
              // than as a puzzle plus a separate key.
              <span className="item-blank" key={`${index}-${segment.blankId}`}>
                <MathText text={answerFor.get(segment.blankId) ?? "?"} />
              </span>
            ),
          )}
        </p>
        <span className="review-label">Word bank</span>
        <ul className="item-options">
          {question.choices.map((choice) => (
            <li className={answered.has(choice.id) ? "correct" : ""} key={choice.id}>
              <MathText text={choice.label} />
              {answered.has(choice.id) && <small>answer</small>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (question.type === "multiple_choice") {
    return (
      <div className="item-detail">
        <p className="item-text">
          <MathText text={question.prompt} />
        </p>
        <ul className="item-options">
          {question.options.map((option) => {
            const correct = option.id === question.correctOptionId;
            return (
              <li className={correct ? "correct" : ""} key={option.id}>
                <MathText text={option.label} />
                {correct && <small>correct</small>}
              </li>
            );
          })}
        </ul>
        <span className="review-label">Why</span>
        <p className="item-note">
          <MathText text={question.rationale} />
        </p>
      </div>
    );
  }

  return (
    <div className="item-detail">
      <p className="item-text">
        <MathText text={question.prompt} />
      </p>
      <span className="review-label">Rubric</span>
      <p className="item-note">
        <MathText text={question.rubric.summary} />
      </p>
      <ul className="item-criteria">
        {question.rubric.criteria.map((criterion) => (
          <li key={criterion.criterion}>
            <strong>
              <MathText text={criterion.criterion} /> ({criterion.points} points)
            </strong>
            <span>
              <MathText text={criterion.guidance} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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
  onSaved: (patch: {
    name: string;
    overallTimeLimitSeconds: number | null;
    takerAllowlist: string[] | null;
  }) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(overview.name);
  const [limitMinutes, setLimitMinutes] = useState(limitToMinutes(overview.overallTimeLimitSeconds));
  const [allowlistText, setAllowlistText] = useState(formatAllowlist(overview.takerAllowlist));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  /** Whether the printed copy carries the answer key; Ctrl+P alone prints the questions only. */
  const [printWithKey, setPrintWithKey] = useState(false);

  function printSet(withKey: boolean) {
    // Rendered in the chosen mode before the dialog opens, since the dialog snapshots the page.
    flushSync(() => setPrintWithKey(withKey));
    window.print();
    setPrintWithKey(false);
  }

  /** Items whose full text is showing. Several at once, since checking a bank means reading it. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const allOpen = expanded.size === overview.items.length && overview.items.length > 0;

  function toggleItem(questionId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  const warmups = overview.items.filter((item) => item.warmup).length;
  const savedMinutes = limitToMinutes(overview.overallTimeLimitSeconds);
  const nameChanged = name !== overview.name;
  const limitChanged = limitMinutes.trim() !== savedMinutes;
  const nextLimitSeconds = limitMinutes.trim() ? Number(limitMinutes) * 60 : null;
  const allowlistChanged = allowlistText !== formatAllowlist(overview.takerAllowlist);
  const changed = nameChanged || limitChanged || allowlistChanged;

  /** Sends only the fields that changed, so saving one cannot clear the other. */
  async function save() {
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const body: {
        name?: string;
        overallTimeLimitSeconds?: number | null;
        allowlist?: string;
      } = {};
      if (nameChanged) body.name = name;
      if (limitChanged) body.overallTimeLimitSeconds = nextLimitSeconds;
      if (allowlistChanged) body.allowlist = allowlistText;

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
      const savedAllowlist = allowlistChanged
        ? ((payload.allowlist as string[] | null) ?? null)
        : overview.takerAllowlist;
      if (allowlistChanged) setAllowlistText(formatAllowlist(savedAllowlist));
      onSaved({
        name: savedName,
        overallTimeLimitSeconds: savedLimit,
        takerAllowlist: savedAllowlist,
      });

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
      if (allowlistChanged) {
        notes.push(
          savedAllowlist?.length
            ? `Restricted to ${savedAllowlist.length} username${savedAllowlist.length === 1 ? "" : "s"}.`
            : "Anyone with the link can take this test.",
        );
      }
      setStatus(notes.join(" "));
    } catch (caught) {
      setError(userFacingMessage(caught, "Unable to update the set."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell dashboard-shell set-overview-shell">
      <Brand onHome={onBack} />

      <header className="quiz-header sequential-header">
        <div>
          <p className="eyebrow">Question set</p>
          <WorkflowTag
            apiKeyPayer={overview.apiKeyPayer}
            materialUploader={overview.materialUploader}
          />
          <h1>{name.trim() || overview.paperName}</h1>
          <div className="quiz-meta">
            {overview.paperName} · {overview.modelId} ·{" "}
            {overview.pdfEngine === "native" ? "native parsing" : overview.pdfEngine}
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
          </div>

          <TakerAllowlistField
            id="setAllowlist"
            value={allowlistText}
            onChange={setAllowlistText}
          />
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
          Generated: <strong>{new Date(overview.createdAt).toLocaleString()}</strong>
        </span>
      </div>

      <div className="list-toolbar">
        <span className="hint">
          {overview.items.length} {overview.items.length === 1 ? "item" : "items"}
          {expanded.size > 0 && ` · ${expanded.size} expanded`}
        </span>
        <div className="list-toolbar-actions">
          <button
            className="secondary"
            type="button"
            disabled={overview.items.length === 0}
            onClick={() => printSet(false)}
          >
            Print question set
          </button>
          <button
            className="secondary"
            type="button"
            disabled={overview.items.length === 0}
            onClick={() => printSet(true)}
          >
            Print with answer key
          </button>
          <button
            className="secondary"
            type="button"
            disabled={overview.items.length === 0}
            onClick={() =>
              setExpanded(allOpen ? new Set() : new Set(overview.items.map((i) => i.questionId)))
            }
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      <section className="summary-list">
        {overview.items.map((item) => {
          const open = expanded.has(item.questionId);
          return (
            <article className={`card summary-item type-${item.type}`} key={item.questionId}>
              {/* The whole head is the control, so the target is the row rather than a chevron. */}
              <button
                className="summary-item-head item-toggle"
                type="button"
                aria-expanded={open}
                onClick={() => toggleItem(item.questionId)}
              >
                <span className="summary-position">{item.position}</span>
                <span className={`type-chip type-${item.type}`}>{TYPE_LABELS[item.type]}</span>
                {item.blockName && <span className="summary-block">{item.blockName}</span>}
                {item.warmup && <span className="pill">Warm-up</span>}
                <span className="item-caret" aria-hidden="true">
                  {open ? "−" : "+"}
                </span>
              </button>
              <p className="summary-description">
                {item.description ? (
                  <MathText text={item.description} />
                ) : (
                  "No description was generated for this item."
                )}
              </p>
              {open && <ItemDetail question={item.question} />}
            </article>
          );
        })}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="template-status">{status}</p>}

      <div className="quiz-actions sequential-actions">
        <button className="secondary" type="button" onClick={onBack}>
          Back to dashboard
        </button>
      </div>

      <PrintableQuestionSet
        overview={overview}
        title={name.trim() || overview.label || overview.paperName}
        withKey={printWithKey}
      />
    </main>
  );
}
