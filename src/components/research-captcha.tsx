"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { QuizWorkspace } from "@/components/quiz/quiz-workspace";
import type { PdfEngine, PublicQuiz } from "@/lib/quiz";

type CatalogModel = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  inputModalities: string[];
  pricing?: { prompt?: string; completion?: string };
  recommended: boolean;
};

export function ResearchCaptcha() {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<CatalogModel | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pdfEngine, setPdfEngine] = useState<PdfEngine>("native");
  const [loadingModels, setLoadingModels] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/openrouter/models")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load models.");
        if (!active) return;
        const loaded = payload.models as CatalogModel[];
        setModels(loaded);
        const preferred =
          loaded.find((model) => model.id === "openai/gpt-5.6-sol") ??
          loaded.find((model) => /anthropic\/claude.*sonnet/i.test(model.id)) ??
          loaded.find((model) => model.recommended) ??
          loaded[0] ??
          null;
        setSelectedModel(preferred);
        setModelSearch(preferred?.name ?? "");
      })
      .catch((caught: Error) => active && setError(caught.message))
      .finally(() => active && setLoadingModels(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      pdfEngine === "native" &&
      selectedModel &&
      !selectedModel.inputModalities.includes("file")
    ) {
      setPdfEngine("cloudflare-ai");
    }
  }, [pdfEngine, selectedModel]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    const matches = query
      ? models.filter(
          (model) =>
            model.name.toLowerCase().includes(query) ||
            model.id.toLowerCase().includes(query),
        )
      : models;
    return matches.slice(0, 60);
  }, [modelSearch, models]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedModel) {
      setError("Choose an OpenRouter model.");
      return;
    }
    setError("");
    setGenerating(true);
    const form = new FormData(event.currentTarget);
    form.set("modelId", selectedModel.id);
    form.set("pdfEngine", pdfEngine);

    try {
      const response = await fetch("/api/quizzes", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to generate questions.");
      setQuiz(payload.quiz as PublicQuiz);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Question generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  if (quiz) {
    return <QuizWorkspace quiz={quiz} />;
  }

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>

      <section>
        <p className="eyebrow">Authorship understanding check</p>
        <h1>Show that you know the work behind the paper.</h1>
        <p className="lede">
          Upload a manuscript, describe your role, and generate a contribution-aware
          fill-in-the-blank assessment. A score of 80% or higher passes.
        </p>
      </section>

      <form className="card form-card" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="paper">Manuscript PDF</label>
            <input
              className="control file-control"
              id="paper"
              name="paper"
              type="file"
              accept="application/pdf,.pdf"
              required
            />
            <small>PDF only, up to 25 MB. The file is sent server-side to OpenRouter.</small>
          </div>

          <div className="field full">
            <label htmlFor="contributions">Your stated contributions</label>
            <textarea
              className="control"
              id="contributions"
              name="contributions"
              minLength={20}
              maxLength={10_000}
              placeholder="Describe the experiments, theory, analysis, writing, or other work you personally contributed..."
              required
            />
          </div>

          <div className="field">
            <label htmlFor="questionCount">Number of questions</label>
            <input
              className="control"
              id="questionCount"
              name="questionCount"
              type="number"
              min={1}
              max={30}
              defaultValue={8}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="distractorsPerBlank">Distractors per correct word</label>
            <input
              className="control"
              id="distractorsPerBlank"
              name="distractorsPerBlank"
              type="number"
              min={0}
              max={10}
              defaultValue={3}
              required
            />
          </div>

          <div className="field full">
            <span className="field-label">Question-generation model</span>
            <div className="model-picker">
              <input
                className="search-control"
                value={modelSearch}
                onChange={(event) => {
                  setModelSearch(event.target.value);
                  setModelPickerOpen(true);
                  if (event.target.value !== selectedModel?.name) setSelectedModel(null);
                }}
                onFocus={() => setModelPickerOpen(true)}
                onBlur={() => window.setTimeout(() => setModelPickerOpen(false), 150)}
                placeholder={loadingModels ? "Loading OpenRouter models..." : "Search models"}
                disabled={loadingModels}
                aria-label="Search OpenRouter models"
                autoComplete="off"
              />
              {modelPickerOpen && !loadingModels && (
                <ul className="model-results">
                  {filteredModels.length === 0 ? (
                    <li className="model-option">No matching models</li>
                  ) : (
                    filteredModels.map((model) => (
                      <li key={model.id}>
                        <button
                          className="model-option"
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setSelectedModel(model);
                            setModelSearch(model.name);
                            setModelPickerOpen(false);
                          }}
                        >
                          <strong>
                            {model.name} {model.recommended && <span className="pill">Recommended</span>}
                          </strong>
                          <span>{model.id}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            {selectedModel && (
              <div className="selected-model">
                <span>{selectedModel.id}</span>
                <span>{selectedModel.contextLength?.toLocaleString() ?? "Unknown"} token context</span>
              </div>
            )}
          </div>

          <div className="field full">
            <label htmlFor="pdfEngine">PDF text extractor</label>
            <select
              className="control"
              id="pdfEngine"
              value={pdfEngine}
              onChange={(event) => setPdfEngine(event.target.value as PdfEngine)}
            >
              <option value="cloudflare-ai">Cloudflare AI — free markdown extraction</option>
              <option value="mistral-ocr">Mistral OCR — paid, best for scans and figures</option>
              <option
                value="native"
                disabled={
                  Boolean(selectedModel) && !selectedModel?.inputModalities.includes("file")
                }
              >
                Native model processing — model input rates apply
              </option>
            </select>
            <small>
              Native processing is available only when the selected model advertises file input.
            </small>
          </div>
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="submit-row">
          <span className="hint">
            Generation may take a few minutes for long or image-heavy manuscripts.
          </span>
          <button className="primary" type="submit" disabled={generating || !selectedModel}>
            {generating ? "Reading paper and generating…" : "Generate questions and begin test"}
          </button>
        </div>
      </form>
    </main>
  );
}
