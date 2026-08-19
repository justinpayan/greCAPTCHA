"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadAttemptEntry, serveAttempt } from "@/components/quiz/attempt-entry";
import { AttemptIntroPage } from "@/components/quiz/attempt-intro";
import { QuizWorkspace } from "@/components/quiz/quiz-workspace";
import { SessionResults, type SessionBlock } from "@/components/quiz/session-results";
import type { AssessmentResult, AttemptIntro, AttemptView } from "@/lib/quiz";

/** Neutral on purpose: the participant is never told which paper the study considers theirs. */
function blockLabel(position: number) {
  return `Paper ${position}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell">
      {children}
    </main>
  );
}

/**
 * Runs both blocks of an experiment from one link.
 *
 * Each block opens on its own landing page and the score is withheld until both are finished,
 * exactly as in the researcher-driven run: seeing a review while a scored block is still ahead
 * would hand over the item formats and the grader's standards.
 *
 * The queue lives in refs because it is read from the callback handed to the workspace, where a
 * captured state value would be stale by the time a block ends. Reloading rebuilds it: a block
 * already graded is collected from the server rather than remembered in the browser.
 */
export function ExperimentSession({ experimentId }: { experimentId: string }) {
  const [intro, setIntro] = useState<AttemptIntro | null>(null);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [finished, setFinished] = useState<SessionBlock[] | null>(null);
  const [closed, setClosed] = useState<{ message: string; paused: boolean } | null>(null);
  const [error, setError] = useState("");

  const queue = useRef<Array<{ attemptId: string; position: number }>>([]);
  const current = useRef<{ attemptId: string; position: number } | null>(null);
  const collected = useRef<SessionBlock[]>([]);
  const total = useRef(0);

  /** Opens the next block that still needs answering, stepping over any already graded. */
  const openNext = useCallback(async () => {
    while (queue.current.length > 0) {
      const next = queue.current[0];
      const entry = await loadAttemptEntry(next.attemptId);

      if (entry.kind === "closed") {
        current.current = next;
        setClosed({ message: entry.message, paused: entry.paused });
        return;
      }

      queue.current.shift();
      if (entry.kind === "result") {
        collected.current.push({ label: blockLabel(next.position), result: entry.result });
        continue;
      }

      current.current = next;
      if (entry.kind === "intro") setIntro(entry.intro);
      else setAttempt(entry.attempt);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setIntro(null);
    setAttempt(null);
    setFinished(collected.current);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/experiments/${encodeURIComponent(experimentId)}/session`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to open this session.");
        }
        if (!active) return;
        const blocks = payload.session.blocks as Array<{
          attemptId: string;
          position: number;
        }>;
        queue.current = [...blocks];
        collected.current = [];
        total.current = blocks.length;
        await openNext();
      })
      .catch((caught: Error) => active && setError(caught.message));
    return () => {
      active = false;
    };
  }, [experimentId, openNext]);

  /** A block finished. Its result is held back and the next block's landing page follows. */
  async function finishBlock(result: AssessmentResult) {
    collected.current.push({
      label: blockLabel(current.current?.position ?? collected.current.length + 1),
      result,
    });
    current.current = null;
    setAttempt(null);
    await openNext();
  }

  if (error) {
    return (
      <Shell>
        <section>
          <p className="eyebrow">Session unavailable</p>
          <h1>This link could not be opened.</h1>
          <p className="lede">{error}</p>
          <p className="lede">Please check with the researcher who sent it.</p>
        </section>
      </Shell>
    );
  }

  if (closed) {
    return (
      <Shell>
        <section>
          <p className="eyebrow">{closed.paused ? "Paused" : "Not open yet"}</p>
          <h1>
            {closed.paused ? "This session is paused." : "This session has not started."}
          </h1>
          <p className="lede">{closed.message}</p>
          <p className="lede">
            Your link stays valid. Keep this page open and reload it when the researcher tells
            you to.
          </p>
        </section>
      </Shell>
    );
  }

  if (finished) {
    return <SessionResults blocks={finished} />;
  }

  if (intro) {
    return (
      <AttemptIntroPage
        intro={intro}
        blockProgress={{ index: collected.current.length + 1, total: total.current }}
        onStart={async () => {
          const entry = await serveAttempt(intro.attemptId);
          setIntro(null);
          if (entry.kind === "closed") {
            setClosed({ message: entry.message, paused: entry.paused });
          } else if (entry.kind === "result") {
            await finishBlock(entry.result);
          } else if (entry.kind === "question") {
            setAttempt(entry.attempt);
          }
        }}
      />
    );
  }

  if (attempt) {
    return (
      <QuizWorkspace
        // Keyed by attempt: the next block swaps in and every piece of state here
        // initialises from props, so it has to remount.
        key={attempt.attemptId}
        initialAttempt={attempt}
        onFinish={(result) => void finishBlock(result)}
      />
    );
  }

  return (
    <Shell>
      <p className="lede">Loading the assessment…</p>
    </Shell>
  );
}
