"use client";

import { useEffect, useState } from "react";

import { loadAttemptEntry, serveAttempt } from "@/components/quiz/attempt-entry";
import { AttemptIntroPage } from "@/components/quiz/attempt-intro";
import { QuizWorkspace, ResultView } from "@/components/quiz/quiz-workspace";
import type { AssessmentResult, AttemptIntro, AttemptView } from "@/lib/quiz";

/**
 * Loads an attempt straight from its ID and hands it to the assessment interface.
 *
 * A fresh attempt opens on its landing page, so the first question's clock starts when the
 * participant presses Start rather than when the link is opened. An attempt already under way
 * skips that and resumes at the current question with its timer intact, so a refresh never
 * loses the session or pretends the clock is not running.
 */
export function ParticipantSession({ attemptId }: { attemptId: string }) {
  const [intro, setIntro] = useState<AttemptIntro | null>(null);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState<{ message: string; paused: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    loadAttemptEntry(attemptId)
      .then((entry) => {
        if (!active) return;
        applyEntry(entry);
      })
      .catch((caught: Error) => active && setError(caught.message));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  function applyEntry(entry: Awaited<ReturnType<typeof loadAttemptEntry>>) {
    if (entry.kind === "closed") setClosed({ message: entry.message, paused: entry.paused });
    else if (entry.kind === "result") setResult(entry.result);
    else if (entry.kind === "question") setAttempt(entry.attempt);
    else setIntro(entry.intro);
  }

  if (closed) {
    return (
      <main className="app-shell">
        <section>
          <p className="eyebrow">{closed.paused ? "Paused" : "Not open yet"}</p>
          <h1>
            {closed.paused
              ? "This assessment is paused."
              : "This assessment has not started."}
          </h1>
          <p className="lede">{closed.message}</p>
          <p className="lede">
            Your link stays valid. Keep this page open and reload it when the researcher tells
            you to.
          </p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="app-shell">
        <section>
          <p className="eyebrow">Assessment unavailable</p>
          <h1>This link could not be opened.</h1>
          <p className="lede">{error}</p>
          <p className="lede">Please check with the researcher who sent it.</p>
        </section>
      </main>
    );
  }

  if (result) return <ResultView result={result} />;
  if (attempt) return <QuizWorkspace initialAttempt={attempt} />;
  if (intro) {
    return (
      <AttemptIntroPage
        intro={intro}
        onStart={async () => {
          const entry = await serveAttempt(attemptId);
          setIntro(null);
          applyEntry(entry);
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <p className="lede">Loading the assessment…</p>
    </main>
  );
}
