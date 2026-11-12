"use client";

import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { OpenRouterKeyPanel } from "@/components/openrouter-key-panel";
import { completeOpenRouterOAuth, validateBrowserOpenRouterKey, type KeySource } from "@/lib/openrouter-browser-key";
import { ParticipantSession } from "./participant-session";
import { ResultView } from "./quiz-workspace";
import type { AssessmentResult, AttemptIntro } from "@/lib/quiz";
import { AttemptIntroPage } from "./attempt-intro";

async function requestAction(id: string, action: string, fields = {}) {
  const response = await fetch(`/api/attempts/${id}/proctoring`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...fields }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Unable to complete this action.");
  return payload;
}

export function SebLaunch({ id, authorPays, closed, score, disqualification, feedbackPending }: {
  id: string;
  authorPays: boolean;
  closed: boolean;
  score: number | null;
  disqualification: string | null;
  feedbackPending: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [launch, setLaunch] = useState<{ link: string; download: string; code: string }>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [key, setKey] = useState("");
  const [keySource, setKeySource] = useState<KeySource>("paste");
  const [working, setWorking] = useState<"launch" | "connect" | null>(null);
  useEffect(() => {
    if (!launch) return;
    let active = true;
    let checking = false;
    async function checkCompletion() {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch(`/api/attempts/${id}/proctoring`, { cache: "no-store" });
        if (!response.ok) return;
        const status = await response.json();
        if (active && status.finished) window.location.replace("/?tab=taken");
      } catch { /* Retry when the browser resumes or the connection returns. */ }
      finally { checking = false; }
    }
    void checkCompletion();
    const timer = window.setInterval(() => void checkCompletion(), 3000);
    const onReturn = () => { if (!document.hidden) void checkCompletion(); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [id, launch]);
  useEffect(() => {
    if (!authorPays) return;
    void completeOpenRouterOAuth().then((connected) => {
      if (connected && "key" in connected) {
        setKey(connected.key);
        setKeySource("oauth");
      }
    }).catch((error: Error) => setError(error.message));
  }, [authorPays]);
  async function run(action: "launch" | "connect") {
    if (working) return;
    setWorking(action);
    setError("");
    setMessage("");
    try {
      if (action === "launch") {
        setLaunch(await requestAction(id, action, { checklist: confirmed }));
      } else {
        const value = keySource === "oauth" ? (await validateBrowserOpenRouterKey()).key : key;
        await requestAction(id, action, { key: value });
        setKey("");
        setMessage(closed ? "Grading requested." : "OpenRouter connected.");
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(null);
    }
  }
  return (
    <main className="app-shell seb-launch-page">
      <Brand href="/" />
      <header className="seb-launch-heading">
        <h1>{closed ? "Assessment submitted" : "Get ready for your assessment"}</h1>
        <p>{closed
          ? "Your answers have been saved. You can finish feedback or check your grading below."
          : "Complete these steps in your regular browser, then open the assessment in Safe Exam Browser (SEB)."}</p>
      </header>

      {disqualification && <p className="seb-launch-notice error" role="status">Disqualified · {disqualification}</p>}
      {score !== null && <p className="seb-launch-notice" role="status">Assessment score {score}%</p>}
      {message && <p className="seb-launch-notice" role="status">{message}</p>}
      {error && <p className="seb-launch-notice error" role="alert">{error}</p>}

      {!closed && (
        <div className="seb-preparation-grid">
          <section className="seb-launch-card" aria-labelledby="seb-install-heading">
            <h2 id="seb-install-heading">Install Safe Exam Browser</h2>
            <p>Install the version specified by your conference for Windows or macOS. If it is already installed, continue to the recording checklist.</p>
            <div className="seb-launch-actions">
              <a className="secondary button-link" href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer">
                Download Safe Exam Browser
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
            <p className="seb-launch-hint">Return to this page to launch your assessment.</p>
          </section>

          <section className="seb-launch-card" aria-labelledby="seb-recording-heading">
            <h2 id="seb-recording-heading">Record your room and equipment</h2>
            <p>Start recording on a separate device, such as your phone. Keep it recording throughout the assessment.</p>
            <ul className="seb-recording-checklist">
              <li>Show a full 360° view of your room.</li>
              <li>Film every port on your computer and monitor.</li>
              <li>Show that you have removed earbuds and smart wearables, including smart glasses and watches.</li>
            </ul>
            <label className="seb-recording-confirmation">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I have recorded all of the checks above and my device is still recording.</span>
            </label>
          </section>
        </div>
      )}

      {(!closed || feedbackPending) && (
        <section className="seb-launch-card seb-launch-entry" aria-labelledby="seb-launch-heading">
          <h2 id="seb-launch-heading">{closed ? "Finish your feedback in SEB" : "Open your assessment"}</h2>
          <p>{closed
            ? "Prepare a launch link, then select Launch in SEB to return to the feedback screen."
            : "Save your work and close other applications. Prepare a launch link below, then select Launch in SEB. If your browser asks to open Safe Exam Browser, allow it."}</p>
          {!closed && (
            <div className="seb-launch-expectations">
              <p>When you launch the exam, you will first use your recording device to film yourself beginning the assessment. You will then have up to five minutes to set up your recording device to record yourself during the exam. Frame your head, torso, computer, and monitor. You must record audio as well as video. You may not talk during the assessment.</p>
            </div>
          )}
          <div className="seb-launch-actions">
            {launch && (closed || confirmed) && (
              <a className="primary button-link" href={launch.link}>Launch in SEB</a>
            )}
            <button
              className={launch ? "secondary" : "primary"}
              type="button"
              disabled={working !== null || (!closed && !confirmed)}
              onClick={() => void run("launch")}
            >
              {working === "launch" ? "Preparing launch…" : launch ? "Generate new launch link" : "Prepare launch link"}
            </button>
          </div>
          <p className="seb-launch-hint">
            {!closed && !confirmed
              ? "Confirm the recording checklist above to enable launch."
              : launch
                ? "This link works once and expires after 10 minutes. Generate a new one if it expires."
                : "You will be signed in automatically when SEB opens."}
          </p>
          {launch && (closed || confirmed) && (
            <details className="seb-launch-fallback">
              <summary>SEB did not open, or it asks for a pairing code</summary>
              <div className="seb-launch-fallback-content">
                <ol>
                  <li>Download the SEB settings file using the button below.</li>
                  <li>Open the downloaded file to launch Safe Exam Browser.</li>
                  <li>If SEB asks for a pairing code, enter the code shown here.</li>
                </ol>
                <div className="seb-launch-actions">
                  <a className="secondary button-link" href={launch.download} download>Download SEB settings file</a>
                </div>
                <div className="seb-pairing-code">
                  <strong>One-time pairing code</strong>
                  <code>{launch.code}</code>
                  <p className="seb-launch-hint">Keep this code available before opening SEB. It expires with the launch link.</p>
                </div>
              </div>
            </details>
          )}
        </section>
      )}

      {authorPays && (
        <details className="seb-launch-card seb-payment-settings" open={closed || undefined}>
          <summary>{closed ? "Reconnect OpenRouter and retry grading" : "Manage your OpenRouter connection"}</summary>
          <OpenRouterKeyPanel storeForAssessment apiKey={key} source={keySource} onChange={(value, source) => {
            setKey(value);
            setKeySource(source);
          }} />
          <div className="seb-launch-actions">
            <button className="secondary" type="button" disabled={working !== null} onClick={() => void run("connect")}>
              {working === "connect" ? "Saving connection…" : closed ? "Retry grading" : "Save OpenRouter connection"}
            </button>
          </div>
        </details>
      )}
    </main>
  );
}

type ProctorState = { started: boolean; closed: boolean; setupEndsAt: number | null; disqualification: string | null };

export function ProctoredSession({ id, intro }: { id: string; intro: AttemptIntro }) {
  const [instructionsRead, setInstructionsRead] = useState(false);
  const [state, setState] = useState<ProctorState>();
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const markClosed = useCallback(() => setState(current => ({
    started: true, setupEndsAt: null, disqualification: null, ...current, closed: true,
  })), []);
  useEffect(() => {
    let active = true;
    const poll = () => {
      void requestAction(id, "check-in").then((data) => {
        if (active) {
          setState(current => current?.closed ? { ...data, closed: true } : data);
          setError("");
        }
      }).catch((error: Error) => { if (active) setError(error.message); });
    };
    poll();
    const checkIn = window.setInterval(poll, 5_000);
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => { active = false; clearInterval(checkIn); clearInterval(clock); };
  }, [id]);

  async function run(action: "setup" | "continue" | "quit") {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const data = await requestAction(id, action);
      if (action === "quit") window.location.assign(data.quitUrl);
      else setState(data);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }
  if (state?.closed) return <SebCompletion id={id} disqualification={state.disqualification} />;
  if (state?.started && !state.closed) return <>
    {error && <p role="alert">Connection interrupted. Reconnecting to the assessment server.</p>}
    <ParticipantSession attemptId={id} proctored onClosed={markClosed} />
  </>;
  if (!state) return <main className="app-shell seb-launch-page seb-session-page">
    <Brand />
    <p role="status">Loading assessment instructions…</p>
    {error && <p className="error" role="alert">{error}</p>}
  </main>;
  const positioning = state?.setupEndsAt != null;
  if (!instructionsRead && !positioning) {
    return <AttemptIntroPage intro={intro} proctored onStart={() => setInstructionsRead(true)} />;
  }
  const remaining = Math.max(0, Math.min(300, Math.ceil(((state?.setupEndsAt ?? 0) - now) / 1000)));
  return <main className="app-shell seb-launch-page seb-session-page">
    <Brand />
    <header className="seb-launch-heading">
      <h1>{positioning ? "Position your recording device" : "How to begin"}</h1>
    </header>
    <section className="seb-launch-card">
      {positioning && <div className="seb-setup-timer">
        <span>Camera setup time remaining</span>
        <strong role="timer" aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</strong>
        <span>Your assessment starts automatically when this reaches 0:00.</span>
      </div>}
      <ul className="seb-recording-checklist">
        {!positioning && <>
          <li>Keep your recording running on your device.</li>
          <li>Film your screen as you select the "Begin assessment setup" link below.</li>
          <li>You will then have up to five minutes to set up your recording device for the assessment.</li>
        </>}
        <li>Show your head and torso throughout the assessment.</li>
        <li>Include your computer and monitor in the frame. The screen contents do not need to be visible.</li>
        <li>Keep the device steady and recording. </li>
        <li>Do not read questions or answers aloud.</li>
      </ul>
      <div className="seb-launch-expectations"><p>{positioning
        ? "Select \"Begin assessment now\" when ready."
        : "Select \"Begin assessment setup\" to start the five-minute camera setup period."}</p></div>
      <div className="seb-launch-actions">
        <button className="primary" type="button" disabled={!state || working || (positioning && remaining === 0)} onClick={() => void run(positioning ? "continue" : "setup")}>
          {!state ? "Loading setup…" : working ? "Please wait…" : positioning ? remaining === 0 ? "Starting assessment…" : "Begin assessment now" : "Begin assessment setup"}
        </button>
      </div>
      {error && <p className="seb-launch-notice error" role="alert">{error}</p>}
    </section>
  </main>;
}

function SebCompletion({ id, disqualification }: { id: string; disqualification: string | null }) {
  const [result, setResult] = useState<AssessmentResult>();
  const [status, setStatus] = useState("Checking grading progress…");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/attempts/${id}/grading`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to check grading. Retrying…");
        if (!active) return;
        setError("");
        if (payload.status === "completed" && payload.result) { setResult(payload.result); return; }
        setStatus(payload.status === "failed" || payload.status === "not_started"
          ? payload.gradingCredentialRequired
            ? "Grading needs attention. Please remain in SEB and contact the organizer for help with the OpenRouter connection."
            : "Grading is not available yet. Please remain in SEB and contact the organizer if it does not resume."
          : payload.status === "running" ? "Your assessment is being graded…" : "Your assessment is queued for grading…");
      } catch (caught) { if (active) setError((caught as Error).message); }
      if (active) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [id]);

  async function quit() {
    const data = await requestAction(id, "quit");
    window.location.assign(data.quitUrl);
  }

  if (result) return <>
    {disqualification && <p className="seb-review-notice" role="status">Flagged for organizer review: {disqualification}. Your saved answers were graded.</p>}
    <ResultView result={result} collectFeedback onFinish={quit} />
  </>;
  return <main className="app-shell seb-launch-page seb-session-page">
    <Brand />
    <header className="seb-launch-heading"><p className="eyebrow">Answers saved</p><h1>Assessment submitted</h1>
      <p>Please wait while your assessment is graded. Keep Safe Exam Browser open.</p></header>
    {disqualification && <p className="seb-launch-notice error" role="status">Flagged for organizer review: {disqualification}</p>}
    <section className="seb-launch-card">
      <h2 role="status">{status}</h2>
      <p>When grading finishes, review your results and submit your feedback here in SEB. You can exit after submitting feedback.</p>
      {error && <p className="seb-launch-notice error" role="alert">{error}</p>}

    </section>
  </main>;
}
