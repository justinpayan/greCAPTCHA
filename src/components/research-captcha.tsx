"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { QuizWorkspace } from "@/components/quiz/quiz-workspace";
import {
  DEFAULT_FILL_PROMPT,
  DEFAULT_FREE_RESPONSE_PROMPT,
  type AttemptView,
  type PdfEngine,
  type QuestionBlockConfig,
} from "@/lib/quiz";

type CatalogModel = {
  id: string;
  name: string;
  contextLength?: number;
  inputModalities: string[];
  recommended: boolean;
};

function newBlock(type: QuestionBlockConfig["type"]): QuestionBlockConfig {
  return type === "fill_blank"
    ? {
        id: crypto.randomUUID(),
        type,
        count: 5,
        distractorsPerBlank: 3,
        prompt: DEFAULT_FILL_PROMPT,
      }
    : {
        id: crypto.randomUUID(),
        type,
        count: 2,
        prompt: DEFAULT_FREE_RESPONSE_PROMPT,
      };
}

export function ResearchCaptcha() {
  const [mode, setMode] = useState<"generate" | "load">("generate");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<CatalogModel | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pdfEngine, setPdfEngine] = useState<PdfEngine>("native");
  const [blocks, setBlocks] = useState<QuestionBlockConfig[]>([
    {
      id: "initial-fill-block",
      type: "fill_blank",
      count: 5,
      distractorsPerBlank: 3,
      prompt: DEFAULT_FILL_PROMPT,
    },
  ]);
  const [randomize, setRandomize] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<AttemptView | null>(null);

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
          loaded.find((model) => model.id === "google/gemini-3.1-pro-preview") ??
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
    return models
      .filter(
        (model) =>
          !query ||
          model.name.toLowerCase().includes(query) ||
          model.id.toLowerCase().includes(query),
      )
      .slice(0, 60);
  }, [modelSearch, models]);

  function updateBlock(id: string, patch: Partial<QuestionBlockConfig>) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === id ? ({ ...block, ...patch } as QuestionBlockConfig) : block,
      ),
    );
  }

  async function generateSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedModel) return setError("Choose an OpenRouter model.");
    if (blocks.length === 0) return setError("Add at least one question type.");
    setWorking(true);
    setError("");
    const form = new FormData(event.currentTarget);
    form.set("modelId", selectedModel.id);
    form.set("pdfEngine", pdfEngine);
    form.set("blocks", JSON.stringify(blocks));
    form.set("randomize", String(randomize));
    try {
      const response = await fetch("/api/question-sets", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to generate questions.");
      setAttempt(payload.attempt as AttemptView);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Question generation failed.");
    } finally {
      setWorking(false);
    }
  }

  async function loadSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const id = String(form.get("questionSetId") ?? "").trim();
    try {
      const response = await fetch(`/api/question-sets/${encodeURIComponent(id)}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ randomize }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load question set.");
      setAttempt(payload.attempt as AttemptView);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load question set.");
    } finally {
      setWorking(false);
    }
  }

  if (attempt) return <QuizWorkspace initialAttempt={attempt} />;

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">R</span>
        ResearchCAPTCHA
      </div>
      <section>
        <p className="eyebrow">Authorship understanding assessment</p>
        <h1>Build an assessment around the work.</h1>
        <p className="lede">
          Generate a reusable mixed-format question set or start a fresh attempt from
          a saved set ID.
        </p>
      </section>

      <div className="mode-tabs" role="tablist" aria-label="Assessment setup mode">
        <button
          type="button"
          className={mode === "generate" ? "active" : ""}
          onClick={() => setMode("generate")}
        >
          Generate new set
        </button>
        <button
          type="button"
          className={mode === "load" ? "active" : ""}
          onClick={() => setMode("load")}
        >
          Load saved set
        </button>
      </div>

      {mode === "load" ? (
        <form className="card form-card" onSubmit={loadSet}>
          <div className="field">
            <label htmlFor="questionSetId">Question-set row ID</label>
            <input
              className="control"
              id="questionSetId"
              name="questionSetId"
              placeholder="Paste a question-set UUID"
              required
            />
            <small>A new attempt and new timing records will be created.</small>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={randomize}
              onChange={(event) => setRandomize(event.target.checked)}
            />
            Randomize question order for this attempt
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="submit-row">
            <span className="hint">The saved questions and rubrics are reused unchanged.</span>
            <button className="primary" type="submit" disabled={working}>
              {working ? "Loading…" : "Load set and begin"}
            </button>
          </div>
        </form>
      ) : (
        <form className="card form-card" onSubmit={generateSet}>
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
              <small>PDF only, up to 25 MB.</small>
            </div>
            <div className="field full">
              <label htmlFor="contributions">Your stated contributions</label>
              <textarea
                className="control"
                id="contributions"
                name="contributions"
                minLength={20}
                maxLength={10_000}
                required
                placeholder="Describe the experiments, theory, analysis, writing, or other work you contributed..."
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
                  placeholder={loadingModels ? "Loading models..." : "Search models"}
                  disabled={loadingModels}
                />
                {modelPickerOpen && !loadingModels && (
                  <ul className="model-results">
                    {filteredModels.map((model) => (
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
                            {model.name}{" "}
                            {model.recommended && <span className="pill">Recommended</span>}
                          </strong>
                          <span>{model.id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="field full">
              <label htmlFor="pdfEngine">PDF text extractor</label>
              <select
                className="control"
                id="pdfEngine"
                value={pdfEngine}
                onChange={(event) => setPdfEngine(event.target.value as PdfEngine)}
              >
                <option value="native">Native model processing</option>
                <option value="cloudflare-ai">Cloudflare AI — free extraction</option>
                <option value="mistral-ocr">Mistral OCR — paid, best for scans</option>
              </select>
            </div>

            <div className="full">
              <div className="section-heading">
                <div>
                  <span className="field-label">Question types</span>
                  <p className="hint">Each card makes one generation request.</p>
                </div>
                <div className="add-buttons">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setBlocks((current) => [...current, newBlock("fill_blank")])}
                  >
                    Add fill-in-the-blank
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setBlocks((current) => [...current, newBlock("free_response")])}
                  >
                    Add free-response
                  </button>
                </div>
              </div>

              <div className="question-blocks">
                {blocks.map((block, index) => (
                  <article className="question-config" key={block.id}>
                    <header>
                      <div>
                        <span className="question-number">Type {index + 1}</span>
                        <h3>
                          {block.type === "fill_blank"
                            ? "Fill in the blank"
                            : "Free response"}
                        </h3>
                      </div>
                      <button
                        className="remove-button"
                        type="button"
                        onClick={() =>
                          setBlocks((current) =>
                            current.filter((candidate) => candidate.id !== block.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </header>
                    <div className="config-grid">
                      <div className="field">
                        <label htmlFor={`${block.id}-count`}>Number of questions</label>
                        <input
                          className="control"
                          id={`${block.id}-count`}
                          type="number"
                          min={1}
                          max={30}
                          value={block.count}
                          onChange={(event) =>
                            updateBlock(block.id, { count: Number(event.target.value) })
                          }
                        />
                      </div>
                      {block.type === "fill_blank" && (
                        <div className="field">
                          <label htmlFor={`${block.id}-distractors`}>
                            Distractors per blank
                          </label>
                          <input
                            className="control"
                            id={`${block.id}-distractors`}
                            type="number"
                            min={0}
                            max={10}
                            value={block.distractorsPerBlank}
                            onChange={(event) =>
                              updateBlock(block.id, {
                                distractorsPerBlank: Number(event.target.value),
                              })
                            }
                          />
                        </div>
                      )}
                      <div className="field full">
                        <label htmlFor={`${block.id}-prompt`}>
                          Question {block.type === "free_response" ? "and rubric " : ""}
                          generation prompt
                        </label>
                        <textarea
                          className="control prompt-control"
                          id={`${block.id}-prompt`}
                          value={block.prompt}
                          onChange={(event) =>
                            updateBlock(block.id, { prompt: event.target.value })
                          }
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <label className="toggle-row full">
              <input
                type="checkbox"
                checked={randomize}
                onChange={(event) => setRandomize(event.target.checked)}
              />
              Randomize question order for the first attempt
            </label>
          </div>

          {error && <p className="error" role="alert">{error}</p>}
          <div className="submit-row">
            <span className="hint">
              Free-response grading makes one additional model call per free-response card.
            </span>
            <button
              className="primary"
              type="submit"
              disabled={working || !selectedModel || blocks.length === 0}
            >
              {working ? "Generating question set…" : "Generate question set and begin"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
