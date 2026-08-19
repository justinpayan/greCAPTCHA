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
 * Participant-facing, and deliberately says very little. The paper is not named here: a
 * filename can hint at which of the two papers is the participant's own, which is exactly what
 * the study design must not reveal.
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
        {blockProgress && (
          <p className="block-progress intro-block">
            Paper {blockProgress.index} of {blockProgress.total}
          </p>
        )}

        <ul className="intro-facts">
          <li>
            {intro.totalQuestions} {intro.totalQuestions === 1 ? "question" : "questions"}, shown
            one at a time.
          </li>
          <li>
            Each answer is locked once submitted, and you cannot return to an earlier question.
          </li>
          {mentionTiming && (
            <li>
              Some questions show a soft time limit. Running over it is recorded, but nothing
              cuts you off and nothing is taken away.
            </li>
          )}
          {intro.overallTimeLimitSeconds !== null && (
            <li>
              You have {Math.round(intro.overallTimeLimitSeconds / 60)} minutes for the whole set.
              When that runs out the assessment ends and anything unanswered is left unanswered.
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
