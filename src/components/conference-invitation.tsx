"use client";

import { FormEvent, useEffect, useState } from "react";

import { Brand } from "@/components/brand";
import { CostEstimateNotice } from "@/components/cost-estimate-notice";
import { AssessmentNotAllowed } from "@/components/quiz/assessment-not-allowed";
import { ManuscriptField } from "@/components/manuscript-field";
import { OpenRouterKeyPanel } from "@/components/openrouter-key-panel";
import {
  completeOpenRouterOAuth,
  validateBrowserOpenRouterKey,
  type KeySource,
} from "@/lib/openrouter-browser-key";
import { errorFromPayload, isOpenRouterError, OpenRouterError } from "@/lib/openrouter-errors";
import { MAX_PDF_BYTES, pdfTooLargeMessage } from "@/lib/uploads";
import type { CostEstimate } from "@/lib/cost-estimate";
import type { ApiKeyPayer, MaterialUploader } from "@/lib/quiz";

export function AssessmentInvitation({
  token,
  template,
  costEstimate = null,
}: {
  token: string;
  /** The model and estimated OpenRouter cost, when the taker's own key pays. */
  costEstimate?: CostEstimate | null;
  /** Deliberately without the test name, which is only ever shown to the creator. */
  template: {
    modelId: string;
    pdfEngine: string;
    questionCount: number;
    apiKeyPayer: ApiKeyPayer;
    materialUploader: MaterialUploader;
    materialFileName: string | null;
  };
}) {
  const [apiKey, setApiKey] = useState("");
  const [keySource, setKeySource] = useState<KeySource>("paste");
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [deniedAs, setDeniedAs] = useState<string | null>(null);
  // OpenRouter problems, shown under the key controls rather than at the bottom of the form.
  const [keyError, setKeyError] = useState("");

  function reportError(caught: unknown, fallback: string) {
    const message = caught instanceof Error ? caught.message : fallback;
    if (isOpenRouterError(caught) && template.apiKeyPayer === "taker") setKeyError(message);
    else setError(message);
  }

  useEffect(() => {
    if (template.apiKeyPayer !== "taker") return;
    void completeOpenRouterOAuth()
      .then((connected) => {
        if (connected && "key" in connected) {
          setApiKey(connected.key);
          setKeySource("oauth");
        }
      })
      .catch((caught) => reportError(caught, "Unable to connect OpenRouter."));
  }, [template.apiKeyPayer]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const paper = form.get("paper");
    if (
      template.materialUploader === "taker" &&
      paper instanceof File &&
      paper.size > MAX_PDF_BYTES
    ) {
      setError(pdfTooLargeMessage(paper.size));
      return;
    }
    setWorking(true);
    setError("");
    setKeyError("");
    setStatus(
      template.materialUploader === "creator"
        ? "Preparing assessment…"
        : form.get("paperUrl")
          ? "Fetching source material…"
          : "Uploading source material…",
    );
    try {
      if (template.apiKeyPayer === "taker") {
        const key =
          keySource === "oauth" ? (await validateBrowserOpenRouterKey()).key : apiKey.trim();
        if (!key) throw new OpenRouterError("Enter or connect an OpenRouter API key.");
        form.set("openrouterApiKey", key);
        form.set("keySource", keySource);
      }
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        jobId?: string;
        error?: string;
        errorSource?: string;
        notAllowed?: boolean;
        username?: string;
      };
      if (response.status === 403 && payload.notAllowed) {
        setDeniedAs(payload.username ?? "");
        return;
      }
      if (!response.ok || !payload.jobId) {
        throw errorFromPayload(payload, "Unable to start assessment generation.");
      }
      if (template.apiKeyPayer === "taker" && keySource === "paste") setApiKey("");
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const jobResponse = await fetch(
          `/api/invitations/jobs/${encodeURIComponent(payload.jobId)}`,
          { cache: "no-store" },
        );
        const jobPayload = (await jobResponse.json()) as {
          error?: string;
          errorSource?: string;
          job?: {
            status: string;
            progressCurrent: number;
            progressTotal: number;
            error?: string;
            errorSource?: string;
            result?: { attemptId?: string };
          };
        };
        if (!jobResponse.ok || !jobPayload.job) {
          throw errorFromPayload(jobPayload, "Unable to check generation.");
        }
        const job = jobPayload.job;
        setStatus(
          job.status === "running"
            ? `Generating section ${Math.min(job.progressCurrent + 1, job.progressTotal)} of ${job.progressTotal}…`
            : "Waiting for a generation worker…",
        );
        if (job.status === "failed") throw errorFromPayload(job, "Question generation failed.");
        if (job.status === "completed") {
          const attemptId = job.result?.attemptId;
          if (!attemptId) throw new Error("Generation completed without an assessment.");
          window.location.assign(`/attempt/${encodeURIComponent(attemptId)}`);
          return;
        }
      }
    } catch (caught) {
      reportError(caught, "Unable to generate the assessment.");
    } finally {
      setWorking(false);
      setStatus("");
    }
  }

  if (deniedAs !== null) {
    return <AssessmentNotAllowed username={deniedAs} />;
  }

  return (
    <main className="app-shell dashboard-shell">
      <Brand href="/" demoBadge />
      <form className="card form-card" onSubmit={(event) => void submit(event)}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Assessment invitation</span>
            {/* The taker knows the test by its paper; before they upload one there is none. */}
            <h1>{template.materialFileName ?? "Upload your paper"}</h1>
          </div>
        </div>
        {template.apiKeyPayer === "taker" && (
          <OpenRouterKeyPanel
            estimate={
              costEstimate && <CostEstimateNotice estimate={costEstimate} includeGeneration />
            }
            apiKey={apiKey}
            source={keySource}
            error={keyError}
            onChange={(key, source) => {
              setApiKey(key);
              setKeySource(source);
              setKeyError("");
            }}
            notice={
              keySource === "paste" && (
                <p className="pasted-key-grading-warning">
                  <strong>Important:</strong> A pasted key is used only to generate this assessment
                  and is not stored. When you finish, you will need to paste an OpenRouter API key
                  again to grade the assessment.
                </p>
              )
            }
          />
        )}
        {template.materialUploader === "taker" && (
          <div className="form-grid">
            <ManuscriptField id="invitation-paper" />
            <div className="field full">
              <label htmlFor="invitation-contributions">
                Your contributions to the manuscript PDF
              </label>
              <textarea
                className="control"
                id="invitation-contributions"
                name="contributions"
                placeholder="Describe what sections or aspects of the manuscript PDF you have contributed to."
              />
            </div>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary invitation-submit" type="submit" disabled={working}>
          {working ? status || "Generating assessment…" : "Generate my assessment"}
        </button>
        <p className="hint invitation-summary">
          {template.questionCount} questions · model selected by the test creator
        </p>
      </form>
    </main>
  );
}

export const ConferenceInvitation = AssessmentInvitation;
