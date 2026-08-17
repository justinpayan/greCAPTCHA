"use client";

import { useState } from "react";

import type { AttemptIntro } from "@/lib/quiz";

/**
 * The landing page shown before a question set.
 *
 * Nothing has been served when this is on screen, so the first question's clock has not
 * started; pressing Start is what begins it. That makes this more than a title card — it moves
 * the start of timing to a moment the participant chooses, instead of whenever the page
 * happened to load or the laptop happened to be handed over.
 *
 * Participant-facing, so the copy stays neutral: it names the paper and the shape of the set,
 * and never which paper this is in the study design.
 */
export function AttemptIntroPage({
  intro,
  blockProgress,
  onStart,
}: {
  intro: AttemptIntro;
  /** "Paper 2 of 2" during a chained experiment run. */
  blockProgress?: { index: number; total: number };
  onStart: () => Promise<void> | void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setStarting(true);
    setError("");
    try {
      await onStart();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start.");
      setStarting(false);
    }
  }

  // Only mentioned when a countdown will actually be visible. An attempt configured to hide it
  // is meant not to make time salient, so advertising limits here would undo that.
  const mentionTiming = intro.timedQuestionCount > 0 && !intro.countdownHidden;

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>

      <section className="card intro-card">
        <p className="eyebrow">Understanding assessment</p>
        <h1>{intro.paperName}</h1>
        {blockProgress && (
          <p className="block-progress intro-block">
            Paper {blockProgress.index} of {blockProgress.total}
          </p>
        )}

        <ul className="intro-facts">
          <li>
            <strong>
              {intro.totalQuestions} {intro.totalQuestions === 1 ? "question" : "questions"}
            </strong>
            , shown one at a time.
          </li>
          <li>
            Each answer is <strong>locked once submitted</strong>, and you cannot return to an
            earlier question.
          </li>
          {mentionTiming && (
            <li>
              Some questions show a <strong>soft time limit</strong>. Running over it is
              recorded, but nothing cuts you off and nothing is taken away.
            </li>
          )}
          <li>
            {mentionTiming
              ? "Timing begins when you press Start, so take as long as you need on this page."
              : "Nothing begins until you press Start, so take as long as you need on this page."}
          </li>
        </ul>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button className="primary intro-start" type="button" disabled={starting} onClick={start}>
          {starting ? "Starting…" : "Start"}
        </button>
      </section>
    </main>
  );
}
