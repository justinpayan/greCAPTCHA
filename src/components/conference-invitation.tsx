"use client";

import { FormEvent, useEffect, useState } from "react";

import { OpenRouterKeyPanel } from "@/components/openrouter-key-panel";
import {
  completeOpenRouterOAuth,
  validateBrowserOpenRouterKey,
  type KeySource,
} from "@/lib/openrouter-browser-key";
import { MAX_PDF_BYTES, MAX_PDF_LABEL, pdfTooLargeMessage } from "@/lib/uploads";

export function ConferenceInvitation({
  token,
  template,
}: {
  token: string;
  template: {
    name: string;
    modelId: string;
    pdfEngine: string;
    questionCount: number;
  };
}) {
  const [apiKey, setApiKey] = useState("");
  const [keySource, setKeySource] = useState<KeySource>("paste");
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void completeOpenRouterOAuth()
      .then((connected) => {
        if (connected && "key" in connected) {
          setApiKey(connected.key);
          setKeySource("oauth");
        }
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Unable to connect OpenRouter."),
      );
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const paper = form.get("paper");
    if (paper instanceof File && paper.size > MAX_PDF_BYTES) {
      setError(pdfTooLargeMessage(paper.size));
      return;
    }
    setWorking(true);
    setError("");
    setStatus("Uploading manuscript…");
    try {
      const key =
        keySource === "oauth" ? (await validateBrowserOpenRouterKey()).key : apiKey.trim();
      if (!key) throw new Error("Enter or connect an OpenRouter API key.");
      form.set("openrouterApiKey", key);
      form.set("keySource", keySource);
      const response = await fetch(`/api/conference/${encodeURIComponent(token)}`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as { jobId?: string; error?: string };
      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error ?? "Unable to start assessment generation.");
      }
      if (keySource === "paste") setApiKey("");
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const jobResponse = await fetch(
          `/api/conference/jobs/${encodeURIComponent(payload.jobId)}`,
          { cache: "no-store" },
        );
        const jobPayload = (await jobResponse.json()) as {
          error?: string;
          job?: {
            status: string;
            progressCurrent: number;
            progressTotal: number;
            error?: string;
            result?: { attemptId?: string };
          };
        };
        if (!jobResponse.ok || !jobPayload.job) {
          throw new Error(jobPayload.error ?? "Unable to check generation.");
        }
        const job = jobPayload.job;
        setStatus(
          job.status === "running"
            ? `Generating section ${Math.min(job.progressCurrent + 1, job.progressTotal)} of ${job.progressTotal}…`
            : "Waiting for a generation worker…",
        );
        if (job.status === "failed") throw new Error(job.error ?? "Question generation failed.");
        if (job.status === "completed") {
          const attemptId = job.result?.attemptId;
          if (!attemptId) throw new Error("Generation completed without an assessment.");
          window.location.assign(`/attempt/${encodeURIComponent(attemptId)}`);
          return;
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate the assessment.");
    } finally {
      setWorking(false);
      setStatus("");
    }
  }

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">G</span>
        greCAPTCHA
      </div>
      <form className="card form-card" onSubmit={(event) => void submit(event)}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Conference assessment</span>
            <h1>{template.name}</h1>
            <p className="hint">
              Upload your manuscript and contribution statement. Your key generates this
              assessment and is not saved by greCAPTCHA.
            </p>
          </div>
        </div>
        <OpenRouterKeyPanel
          apiKey={apiKey}
          source={keySource}
          onChange={(key, source) => {
            setApiKey(key);
            setKeySource(source);
          }}
        />
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="conference-paper">Manuscript PDF</label>
            <input
              className="control file-control"
              id="conference-paper"
              name="paper"
              type="file"
              accept="application/pdf,.pdf"
              required
            />
            <small>PDF only, up to {MAX_PDF_LABEL}.</small>
          </div>
          <div className="field full">
            <label htmlFor="conference-contributions">Your contribution statement</label>
            <textarea
              className="control"
              id="conference-contributions"
              name="contributions"
              placeholder="Describe the experiments, theory, analysis, writing, or other work you contributed."
            />
          </div>
        </div>
        <p className="hint">
          {template.questionCount} questions · model selected by the conference assessor
        </p>
        {status && <p className="status-note">{status}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={working}>
          {working ? "Generating assessment…" : "Generate my assessment"}
        </button>
      </form>
    </main>
  );
}
