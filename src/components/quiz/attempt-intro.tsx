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

  return (
    <main className="app-shell">
      <section className="card intro-card">
        {blockProgress && (
          <p className="block-progress intro-block">
            Paper {blockProgress.index} of {blockProgress.total}
          </p>
        )}

        <ul className="intro-facts">
          <li>
            {intro.totalQuestions} {intro.totalQuestions === 1 ? "question" : "questions"} in total.
            Use the question overview to move between them at any time.
          </li>
          <li>
            Your work saves automatically. You can skip a question and return to it before you
            submit the assessment.
          </li>
          {intro.overallTimeLimitSeconds !== null && (
            <li>
              You have {Math.round(intro.overallTimeLimitSeconds / 60)} minutes for the whole set.
              When time runs out, all saved work is submitted automatically as-is.
            </li>
          )}
          <li>
            Submit the assessment when you are finished. Nothing begins until you press Start, so
            take as long as you need on this page.
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
