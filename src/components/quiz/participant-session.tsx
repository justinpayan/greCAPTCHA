"use client";

import { useEffect, useState } from "react";

import { QuizWorkspace, ResultView } from "@/components/quiz/quiz-workspace";
import type { AssessmentResult, AttemptView } from "@/lib/quiz";

/**
 * Loads an attempt straight from its ID and hands it to the assessment interface. A refresh
 * re-reads the server state, so a participant who reloads resumes at the current question
 * with its timer intact rather than losing the session.
 */
export function ParticipantSession({ attemptId }: { attemptId: string }) {
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState<{ message: string; paused: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/attempts/${encodeURIComponent(attemptId)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!active) return;
        // A closed link is the expected state for one that was sent out in advance, so it
        // gets its own screen rather than the failure page.
        if (response.status === 403 && payload.locked) {
          setClosed({ message: payload.error as string, paused: payload.paused === true });
          return;
        }
        if (!response.ok) throw new Error(payload.error ?? "Unable to open this assessment.");
        if (payload.result) setResult(payload.result as AssessmentResult);
        else setAttempt(payload.attempt as AttemptView);
      })
      .catch((caught: Error) => active && setError(caught.message));
    return () => {
      active = false;
    };
  }, [attemptId]);

  if (closed) {
    return (
      <main className="app-shell">
        <div className="brand">
          <span className="brand-mark">R</span>
          ResearchCAPTCHA
        </div>
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
        <div className="brand">
          <span className="brand-mark">R</span>
          ResearchCAPTCHA
        </div>
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

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>
      <p className="lede">Loading the assessment…</p>
    </main>
  );
}
