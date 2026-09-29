"use client";

import { useState } from "react";

import { Brand } from "@/components/brand";
import type { AttemptIntro } from "@/lib/quiz";

/**
 * The landing page shown before a question set.
 *
 * Nothing has been served when this is on screen, so the first question's clock has not
 * started; pressing Start is what begins it. That makes this more than a title card — it moves
 * the start of timing to a moment the examinee chooses, instead of whenever the page
 * happened to load or the laptop happened to be handed over.
 *
 * Examinee-facing, and deliberately says very little.
 */
export function AttemptIntroPage({
  intro,
  onStart,
}: {
  intro: AttemptIntro;
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
    <main className="app-shell centered-shell">
      <Brand />
      <section className="card intro-card" aria-labelledby="intro-title">
        <h1 className="intro-title" id="intro-title">
          Instructions
        </h1>
        <ul className="intro-facts">
          <li>
            {intro.totalQuestions} {intro.totalQuestions === 1 ? "question" : "questions"} in total.
            Use the question overview to move between them at any time.
          </li>
          <li>
            Your work saves automatically. You can skip a question and return to it before you
            submit the assessment.
          </li>
          <li>
            {intro.overallTimeLimitSeconds === null ? (
              <>There is no time limit for this assessment; you will have unlimited time.</>
            ) : (
              <>
                You have {Math.round(intro.overallTimeLimitSeconds / 60)} minutes for the whole
                set. When time runs out, all saved work is submitted automatically as-is.
              </>
            )}
          </li>
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
