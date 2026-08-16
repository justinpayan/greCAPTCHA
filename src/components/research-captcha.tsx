"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AttemptSummary } from "@/components/quiz/attempt-summary";
import { QuizWorkspace, ResultView } from "@/components/quiz/quiz-workspace";
import {
  DEFAULT_FILL_PROMPT,
  DEFAULT_FREE_RESPONSE_PROMPT,
  DEFAULT_MULTIPLE_CHOICE_PROMPT,
  type AssessmentResult,
  type AttemptListEntry,
  type AttemptOutline,
  type AttemptView,
  type QuestionSetListEntry,
  type PdfEngine,
  type QuestionBlockConfig,
  type StudyTemplateConfig,
  type StudyTemplateSummary,
} from "@/lib/quiz";

type CatalogModel = {
  id: string;
  name: string;
  contextLength?: number;
  inputModalities: string[];
  recommended: boolean;
};

const BLOCK_LABELS: Record<QuestionBlockConfig["type"], string> = {
  fill_blank: "Fill in the blank",
  multiple_choice: "Multiple choice",
  free_response: "Free response",
};

function newBlock(type: QuestionBlockConfig["type"]): QuestionBlockConfig {
  const id = crypto.randomUUID();
  if (type === "fill_blank") {
    return {
      id,
      type,
      name: "",
      count: 5,
      distractorsPerBlank: 3,
      timeLimitSeconds: null,
      warmup: false,
      prompt: DEFAULT_FILL_PROMPT,
    };
  }
  if (type === "multiple_choice") {
    return {
      id,
      type,
      name: "",
      count: 5,
      optionsPerQuestion: 4,
      timeLimitSeconds: null,
      warmup: false,
      prompt: DEFAULT_MULTIPLE_CHOICE_PROMPT,
    };
  }
  return {
    id,
    type,
    name: "",
    count: 2,
    timeLimitSeconds: null,
    warmup: false,
    prompt: DEFAULT_FREE_RESPONSE_PROMPT,
  };
}

/**
 * Helper text for a field that shares a grid row with another field. Rendered as a bubble
 * anchored to the label so it takes no vertical space and cannot misalign its neighbour.
 */
function FieldHint({ text }: { text: string }) {
  return (
    <span className="field-hint" tabIndex={0}>
      <span className="field-hint-mark" aria-hidden="true">
        ?
      </span>
      <span className="field-hint-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

/**
 * Suppresses the timer in the test-taking interface. Soft limits still apply to the
 * attempt and every duration is still recorded server-side; only the display changes.
 * Fixed for the whole attempt so all of its questions are answered under one condition.
 */
function CountdownToggle({
  className,
  hidden,
  onChange,
}: {
  className?: string;
  hidden: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`toggle-row ${className ?? ""}`.trim()}>
      <input
        type="checkbox"
        checked={hidden}
        onChange={(event) => onChange(event.target.checked)}
      />
      Hide the on-screen countdown — every timing is still recorded
    </label>
  );
}

export function ResearchCaptcha() {
  const [mode, setMode] = useState<"generate" | "load" | "resume">("generate");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<CatalogModel | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pdfEngine, setPdfEngine] = useState<PdfEngine>("native");
  const [blocks, setBlocks] = useState<QuestionBlockConfig[]>([
    {
      id: "initial-fill-block",
      type: "fill_blank",
      name: "",
      count: 5,
      distractorsPerBlank: 3,
      timeLimitSeconds: null,
      warmup: false,
      prompt: DEFAULT_FILL_PROMPT,
    },
  ]);
  const [randomize, setRandomize] = useState(false);
  const [countdownHidden, setCountdownHidden] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [outline, setOutline] = useState<AttemptOutline | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [setName, setSetName] = useState("");
  const [savedSets, setSavedSets] = useState<QuestionSetListEntry[]>([]);
  const [attemptList, setAttemptList] = useState<AttemptListEntry[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [templates, setTemplates] = useState<StudyTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateStatus, setTemplateStatus] = useState("");
  // Blocks autosaving until the stored draft has been applied, so the restore is never
  // overwritten by the component's own initial state.
  const [restored, setRestored] = useState(false);

  const currentConfig = useMemo<StudyTemplateConfig>(
    () => ({
      modelId: selectedModel?.id ?? "",
      pdfEngine,
      blocks,
      randomize,
      countdownHidden,
    }),
    [selectedModel, pdfEngine, blocks, randomize, countdownHidden],
  );

  function applyConfig(config: StudyTemplateConfig, catalog: CatalogModel[]) {
    setPdfEngine(config.pdfEngine);
    setBlocks(config.blocks);
    setRandomize(config.randomize);
    setCountdownHidden(config.countdownHidden);
    const match = catalog.find((model) => model.id === config.modelId);
    if (match) {
      setSelectedModel(match);
      setModelSearch(match.name);
    }
    return Boolean(match);
  }

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetch("/api/openrouter/models").then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load models.");
        return payload.models as CatalogModel[];
      }),
      fetch("/api/templates").then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load templates.");
        return payload as {
          templates: StudyTemplateSummary[];
          draft: StudyTemplateConfig | null;
        };
      }),
    ])
      .then(([modelResult, templateResult]) => {
        if (!active) return;
        const catalog = modelResult.status === "fulfilled" ? modelResult.value : [];
        setModels(catalog);
        if (modelResult.status === "rejected") {
          setError(
            modelResult.reason instanceof Error
              ? modelResult.reason.message
              : "Unable to load models.",
          );
        }

        const stored =
          templateResult.status === "fulfilled" ? templateResult.value : null;
        setTemplates(stored?.templates ?? []);

        // Restoring the draft must win over the default model pick, so both fetches are
        // resolved together rather than racing to set the selection.
        const restoredModel = stored?.draft ? applyConfig(stored.draft, catalog) : false;
        if (!restoredModel && catalog.length) {
          const preferred =
            catalog.find((model) => model.id === "google/gemini-3.1-pro-preview") ??
            catalog.find((model) => /anthropic\/claude.*sonnet/i.test(model.id)) ??
            catalog.find((model) => model.recommended) ??
            catalog[0] ??
            null;
          setSelectedModel(preferred);
          setModelSearch(preferred?.name ?? "");
        }
        if (stored?.draft) setTemplateStatus("Restored your last configuration.");
      })
      .finally(() => {
        if (!active) return;
        setLoadingModels(false);
        setRestored(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Autosave the working configuration so a reload or a server restart resumes it.
  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: currentConfig }),
      }).catch(() => {
        // The draft is a convenience; a failed autosave must not interrupt setup.
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [currentConfig, restored]);

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

  const refreshCatalog = useCallback(async () => {
    const [setsResult, attemptsResult] = await Promise.allSettled([
      fetch("/api/question-sets").then((response) => response.json()),
      fetch("/api/attempts").then((response) => response.json()),
    ]);
    if (setsResult.status === "fulfilled" && setsResult.value.sets) {
      setSavedSets(setsResult.value.sets as QuestionSetListEntry[]);
    }
    if (attemptsResult.status === "fulfilled" && attemptsResult.value.attempts) {
      setAttemptList(attemptsResult.value.attempts as AttemptListEntry[]);
    }
  }, []);

  // Reload the lists whenever a browsing tab is opened, so a set generated moments ago and
  // an attempt just answered on this laptop both appear without a page refresh.
  useEffect(() => {
    if (mode === "generate") return;
    void refreshCatalog();
  }, [mode, refreshCatalog]);

  const visibleSets = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return savedSets;
    return savedSets.filter((set) =>
      [set.label, set.paperName, set.modelId, set.id].some((field) =>
        field.toLowerCase().includes(query),
      ),
    );
  }, [catalogSearch, savedSets]);

  const visibleAttempts = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return attemptList;
    return attemptList.filter((entry) =>
      [entry.setLabel, entry.paperName, entry.status, entry.id].some((field) =>
        field.toLowerCase().includes(query),
      ),
    );
  }, [catalogSearch, attemptList]);

  async function startFromSet(questionSetId: string) {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(
        `/api/question-sets/${encodeURIComponent(questionSetId)}/attempts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ randomize, countdownHidden }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load question set.");
      await showSummary((payload.attempt as AttemptView).attemptId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load question set.");
    } finally {
      setWorking(false);
    }
  }

  async function commitRename(id: string) {
    const next = renameValue;
    setRenamingId("");
    try {
      const response = await fetch(`/api/question-sets/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to rename the set.");
      await refreshCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to rename the set.");
    }
  }

  /** Every entry point lands on the researcher-facing plan, never straight into a question. */
  async function showSummary(attemptId: string) {
    const response = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/outline`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load the attempt summary.");
    setOutline(payload.outline as AttemptOutline);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openAttempt(attemptId: string) {
    setWorking(true);
    setError("");
    try {
      await showSummary(attemptId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open the attempt.");
    } finally {
      setWorking(false);
    }
  }

  async function saveTemplate() {
    setTemplateStatus("");
    setError("");
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName, config: currentConfig }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save the template.");
      const saved = payload.template as StudyTemplateSummary;
      setTemplates((current) => [saved, ...current.filter((one) => one.id !== saved.id)]);
      setTemplateId(saved.id);
      setTemplateName("");
      setTemplateStatus(`Saved “${saved.name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the template.");
    }
  }

  async function loadTemplate(id: string) {
    setTemplateId(id);
    setTemplateStatus("");
    if (!id) return;
    setError("");
    try {
      const response = await fetch(`/api/templates/${encodeURIComponent(id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load the template.");
      const template = payload.template as {
        name: string;
        config: StudyTemplateConfig;
      };
      const matchedModel = applyConfig(template.config, models);
      setTemplateStatus(
        matchedModel
          ? `Loaded “${template.name}”.`
          : `Loaded “${template.name}”. Its model is not in the current catalog, so the model selection was left unchanged.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the template.");
    }
  }

  async function deleteTemplate() {
    const target = templates.find((one) => one.id === templateId);
    if (!target) return;
    if (!window.confirm(`Delete the template “${target.name}”? This cannot be undone.`)) {
      return;
    }
    setError("");
    try {
      const response = await fetch(`/api/templates/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete the template.");
      setTemplates((current) => current.filter((one) => one.id !== target.id));
      setTemplateId("");
      setTemplateStatus(`Deleted “${target.name}”. Your current setup is unchanged.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the template.");
    }
  }

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
    form.set("countdownHidden", String(countdownHidden));
    form.set("name", setName);
    try {
      const response = await fetch("/api/question-sets", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to generate questions.");
      await showSummary((payload.attempt as AttemptView).attemptId);
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
        body: JSON.stringify({ randomize, countdownHidden }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load question set.");
      await showSummary((payload.attempt as AttemptView).attemptId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load question set.");
    } finally {
      setWorking(false);
    }
  }

  if (result) return <ResultView result={result} />;
  if (attempt) return <QuizWorkspace initialAttempt={attempt} />;
  if (outline) {
    return (
      <AttemptSummary
        outline={outline}
        onStart={(next) => {
          setAttempt(next);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onResult={(next) => {
          setResult(next);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    );
  }

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
          a saved set&nbsp;ID.
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
        <button
          type="button"
          className={mode === "resume" ? "active" : ""}
          onClick={() => setMode("resume")}
        >
          Resume attempt
        </button>
      </div>

      {mode === "generate" && (
        <section className="card template-card">
          <div className="template-heading">
            <div>
              <span className="field-label">Study set template</span>
              <p className="hint">
                Everything below except the PDF and the contribution statement. Your current
                setup is saved automatically and restored on the next visit.
              </p>
            </div>
          </div>
          <div className="template-controls">
            <div className="field">
              <label htmlFor="templatePicker">Saved templates</label>
              <select
                className="control"
                id="templatePicker"
                value={templateId}
                onChange={(event) => loadTemplate(event.target.value)}
              >
                <option value="">
                  {templates.length ? "Select a template to load…" : "No saved templates"}
                </option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="templateName">
                Save current setup as
                <FieldHint text="Saving under a name that already exists replaces that template." />
              </label>
              <input
                className="control"
                id="templateName"
                value={templateName}
                placeholder="Template name"
                maxLength={120}
                onChange={(event) => setTemplateName(event.target.value)}
              />
            </div>
            <div className="template-buttons">
              <button
                className="secondary"
                type="button"
                disabled={!templateName.trim()}
                onClick={saveTemplate}
              >
                Save template
              </button>
              <button
                className="secondary"
                type="button"
                disabled={!templateId}
                onClick={deleteTemplate}
              >
                Delete selected
              </button>
            </div>
          </div>
          {templateStatus && <p className="template-status">{templateStatus}</p>}
        </section>
      )}

      {mode === "resume" || mode === "load" ? (
        <section className="card form-card">
          <div className="field">
            <label htmlFor="catalogSearch">
              {mode === "load" ? "Search saved sets" : "Search attempts"}
            </label>
            <input
              className="control"
              id="catalogSearch"
              value={catalogSearch}
              placeholder={
                mode === "load"
                  ? "Filter by set name, paper, or model"
                  : "Filter by set name, paper, or status"
              }
              onChange={(event) => setCatalogSearch(event.target.value)}
            />
          </div>

          {mode === "load" ? (
            <>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={randomize}
                  onChange={(event) => setRandomize(event.target.checked)}
                />
                Randomize question order for this attempt
              </label>
              <CountdownToggle hidden={countdownHidden} onChange={setCountdownHidden} />
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="catalog-list">
                {visibleSets.length === 0 && (
                  <p className="hint catalog-empty">
                    {savedSets.length
                      ? "No set matches that search."
                      : "No question sets have been generated yet."}
                  </p>
                )}
                {visibleSets.map((set) => (
                  <article className="catalog-row" key={set.id}>
                    <div className="catalog-main">
                      {renamingId === set.id ? (
                        <input
                          className="control catalog-rename"
                          value={renameValue}
                          autoFocus
                          maxLength={120}
                          placeholder={set.paperName}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={() => void commitRename(set.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitRename(set.id);
                            if (event.key === "Escape") setRenamingId("");
                          }}
                        />
                      ) : (
                        <strong>{set.label}</strong>
                      )}
                      <span className="catalog-meta">
                        {set.paperName} · {set.questionCount}{" "}
                        {set.questionCount === 1 ? "question" : "questions"} ·{" "}
                        {set.attemptCount}{" "}
                        {set.attemptCount === 1 ? "attempt" : "attempts"} · {set.modelId}
                      </span>
                    </div>
                    <div className="catalog-actions">
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          setRenamingId(set.id);
                          setRenameValue(set.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={working}
                        onClick={() => void startFromSet(set.id)}
                      >
                        Start attempt
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="catalog-list">
                {visibleAttempts.length === 0 && (
                  <p className="hint catalog-empty">
                    {attemptList.length
                      ? "No attempt matches that search."
                      : "No attempts have been started yet."}
                  </p>
                )}
                {visibleAttempts.map((entry) => (
                  <article className="catalog-row" key={entry.id}>
                    <div className="catalog-main">
                      <strong>{entry.setLabel}</strong>
                      <span className="catalog-meta">
                        {entry.answeredCount} of {entry.totalQuestions} answered ·{" "}
                        {entry.status === "graded"
                          ? `graded${entry.score === null ? "" : ` at ${entry.score}%`}`
                          : "in progress"}
                        {entry.randomize && " · randomized"} ·{" "}
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="catalog-actions">
                      <button
                        className="primary"
                        type="button"
                        disabled={working}
                        onClick={() => void openAttempt(entry.id)}
                      >
                        {entry.status === "graded"
                          ? "Open"
                          : entry.answeredCount
                            ? "Resume"
                            : "Open"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <form className="card form-card" onSubmit={generateSet}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="setName">
                Test set name
                <FieldHint text="Identifies this set in the saved-set list. Leave blank to use the PDF filename. You can rename it later." />
              </label>
              <input
                className="control"
                id="setName"
                value={setName}
                maxLength={120}
                placeholder="e.g. Pilot form A — Gyevnar CHI submission"
                onChange={(event) => setSetName(event.target.value)}
              />
            </div>
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
                    className="secondary type-fill_blank"
                    type="button"
                    onClick={() => setBlocks((current) => [...current, newBlock("fill_blank")])}
                  >
                    <span className="type-dot" aria-hidden="true" />
                    Add fill-in-the-blank
                  </button>
                  <button
                    className="secondary type-multiple_choice"
                    type="button"
                    onClick={() =>
                      setBlocks((current) => [...current, newBlock("multiple_choice")])
                    }
                  >
                    <span className="type-dot" aria-hidden="true" />
                    Add multiple-choice
                  </button>
                  <button
                    className="secondary type-free_response"
                    type="button"
                    onClick={() => setBlocks((current) => [...current, newBlock("free_response")])}
                  >
                    <span className="type-dot" aria-hidden="true" />
                    Add free-response
                  </button>
                </div>
              </div>

              <div className="question-blocks">
                {blocks.map((block, index) => (
                  <article
                    className={`question-config type-${block.type}`}
                    key={block.id}
                  >
                    <header>
                      <div>
                        <div className="card-title-row">
                          <span className="question-number">Type {index + 1}</span>
                          <span className={`type-chip type-${block.type}`}>
                            {BLOCK_LABELS[block.type]}
                          </span>
                          {block.warmup && <span className="pill">Warm-up</span>}
                        </div>
                        <h3>{block.name.trim() || BLOCK_LABELS[block.type]}</h3>
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
                        <label htmlFor={`${block.id}-name`}>
                          Card name
                          <FieldHint text="Researcher-facing only. Stored with every question this card generates so answers can be grouped by family. Never shown to the participant." />
                        </label>
                        <input
                          className="control"
                          id={`${block.id}-name`}
                          value={block.name}
                          maxLength={80}
                          placeholder={`e.g. F1 planted error`}
                          onChange={(event) =>
                            updateBlock(block.id, { name: event.target.value })
                          }
                        />
                      </div>
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
                      {block.type === "multiple_choice" && (
                        <div className="field">
                          <label htmlFor={`${block.id}-options`}>
                            Options per question
                            <FieldHint text="Set 2 for true/false items." />
                          </label>
                          <input
                            className="control"
                            id={`${block.id}-options`}
                            type="number"
                            min={2}
                            max={10}
                            value={block.optionsPerQuestion}
                            onChange={(event) =>
                              updateBlock(block.id, {
                                optionsPerQuestion: Number(event.target.value),
                              })
                            }
                          />
                        </div>
                      )}
                      <div className="field">
                        <label htmlFor={`${block.id}-time-limit`}>
                          Soft time limit (seconds)
                          <FieldHint text="Shown as a countdown and recorded as an overrun. Answers are never cut off or penalised." />
                        </label>
                        <input
                          className="control"
                          id={`${block.id}-time-limit`}
                          type="number"
                          min={5}
                          max={3600}
                          value={block.timeLimitSeconds ?? ""}
                          placeholder="Leave blank for untimed"
                          onChange={(event) =>
                            updateBlock(block.id, {
                              timeLimitSeconds:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                        />
                      </div>
                      <label className="toggle-row full">
                        <input
                          type="checkbox"
                          checked={block.warmup}
                          onChange={(event) =>
                            updateBlock(block.id, { warmup: event.target.checked })
                          }
                        />
                        Warm-up card — asked first and excluded from the overall score
                      </label>
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
            <CountdownToggle
              className="full"
              hidden={countdownHidden}
              onChange={setCountdownHidden}
            />
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
