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

  useEffect(() => {
    let active = true;
    fetch(`/api/attempts/${encodeURIComponent(attemptId)}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to open this assessment.");
        if (!active) return;
        if (payload.result) setResult(payload.result as AssessmentResult);
        else setAttempt(payload.attempt as AttemptView);
      })
      .catch((caught: Error) => active && setError(caught.message));
    return () => {
      active = false;
    };
  }, [attemptId]);

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
