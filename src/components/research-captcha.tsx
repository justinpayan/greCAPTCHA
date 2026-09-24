"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createDefaultStudyBlocks,
  createDefaultStudyTemplate,
  isLegacyStarterTemplate,
} from "@/lib/default-study-template";
import { MAX_PDF_BYTES, MAX_PDF_LABEL, pdfTooLargeMessage } from "@/lib/uploads";
import {
  completeOpenRouterOAuth,
  readBrowserOpenRouterKey,
  validateBrowserOpenRouterKey,
  type KeySource,
} from "@/lib/openrouter-browser-key";

import { ProfessorOpenRouterPanel } from "@/components/professor-openrouter-panel";
import { SetOverview } from "@/components/set-overview";
import {
  loadAttemptEntry,
  serveAttempt,
  type AttemptEntry,
} from "@/components/quiz/attempt-entry";
import { AttemptIntroPage } from "@/components/quiz/attempt-intro";
import { AttemptSummary } from "@/components/quiz/attempt-summary";
import { QuizWorkspace, ResultView } from "@/components/quiz/quiz-workspace";
import {
  DEFAULT_FILL_PROMPT,
  DEFAULT_FREE_RESPONSE_PROMPT,
  DEFAULT_MULTIPLE_CHOICE_PROMPT,
  type AssessmentResult,
  type AttemptIntro,
  type AttemptListEntry,
  type AttemptOutline,
  type AttemptView,
  type QuestionSetListEntry,
  type QuestionSetOverview,
  type PdfEngine,
  type QuestionBlockConfig,
  type StudyTemplateConfig,
  type StudyTemplateSummary,
  type WorkflowType,
} from "@/lib/quiz";

type CatalogModel = {
  id: string;
  name: string;
  contextLength?: number;
  inputModalities: string[];
  recommended: boolean;
};

const DEFAULT_MODEL_ID = "openai/gpt-5.6-sol";
const FEATURED_MODEL_IDS = [
  "anthropic/claude-fable-5.1",
  DEFAULT_MODEL_ID,
] as const;
const FEATURED_MODELS: CatalogModel[] = [
  {
    id: DEFAULT_MODEL_ID,
    name: "GPT-5.6 Sol",
    inputModalities: ["text", "file"],
    recommended: true,
  },
  {
    id: "anthropic/claude-fable-5.1",
    name: "Claude Fable 5.1",
    inputModalities: ["text", "file"],
    recommended: true,
  },
];

function preferredModel(catalog: CatalogModel[]) {
  return (
    catalog.find((model) => model.id === DEFAULT_MODEL_ID) ??
    catalog.find((model) => /anthropic\/claude.*sonnet/i.test(model.id)) ??
    catalog.find((model) => model.recommended) ??
    catalog[0] ??
    null
  );
}

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
 * Suppresses the **per-question** timer in the test-taking interface. Soft limits still apply to
 * the attempt and every duration is still recorded server-side; only the display changes. Fixed
 * for the whole attempt so all of its questions are answered under one condition.
 *
 * A set's overall limit keeps its clock either way. That limit is enforced — it ends the assessment
 * — so hiding it would mean cutting a participant off with nothing on screen to warn them.
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
      Hide the per-question countdown — every timing is still recorded
    </label>
  );
}

export function ResearchCaptcha({ username }: { username: string }) {
  const [mode, setMode] = useState<"default" | "custom" | "load" | "resume" | "mine">(
    "default",
  );
  const [models, setModels] = useState<CatalogModel[]>(FEATURED_MODELS);
  const [defaultModel, setDefaultModel] = useState<CatalogModel | null>(FEATURED_MODELS[0]);
  const [defaultModelSearch, setDefaultModelSearch] = useState("");
  const [defaultModelPickerOpen, setDefaultModelPickerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<CatalogModel | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [pdfEngine, setPdfEngine] = useState<PdfEngine>("native");
  const [blocks, setBlocks] = useState<QuestionBlockConfig[]>(createDefaultStudyBlocks);
  const [randomize, setRandomize] = useState(false);
  const [countdownHidden, setCountdownHidden] = useState(false);
  /** Whole minutes in the form, seconds in the data. Empty means no overall limit. */
  const [overallLimitMinutes, setOverallLimitMinutes] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [working, setWorking] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationNotice, setGenerationNotice] = useState("");
  const [error, setError] = useState("");
  const [failedGenerationJobId, setFailedGenerationJobId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sharingSetId, setSharingSetId] = useState("");
  const [copiedSetId, setCopiedSetId] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareLinks, setShareLinks] = useState<
    Record<string, { url: string }>
  >({});
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  /** Landing page for a question set that has not been served yet. */
  const [intro, setIntro] = useState<AttemptIntro | null>(null);
  const [outline, setOutline] = useState<AttemptOutline | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [setName, setSetName] = useState("");
  const [savedSets, setSavedSets] = useState<QuestionSetListEntry[]>([]);
  const [attemptList, setAttemptList] = useState<AttemptListEntry[]>([]);
  const [myAssessments, setMyAssessments] = useState<AttemptListEntry[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  /** Attempt whose link is mid-update, so only that row's button shows a pending state. */
  const [togglingLinkId, setTogglingLinkId] = useState("");
  const [resettingId, setResettingId] = useState("");
  const [paperError, setPaperError] = useState("");
  /** The set whose overview is open. Replaces the old inline rename in the list. */
  const [setOverview, setSetOverview] = useState<QuestionSetOverview | null>(null);
  /**
   * Browser-history mirror of the screens stacked on top of the dashboard.
   *
   * Every screen here is React state on one route, so without this the browser's Back button
   * leaves the app entirely — from anywhere in the dashboard it went to `/login`, which reads as
   * being signed out. One history entry is pushed per layer and popped back off in step, so Back
   * walks the screens the way it walks pages.
   *
   * A ref rather than state: it is read inside async handlers and inside the popstate listener,
   * where a captured state value would be stale.
   */
  const layers = useRef<Array<"overview" | "outline" | "assessment">>([]);
  const [templates, setTemplates] = useState<StudyTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [workflowType, setWorkflowType] = useState<WorkflowType>("course");
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
      overallTimeLimitSeconds: overallLimitMinutes
        ? Number(overallLimitMinutes) * 60
        : null,
    }),
    [selectedModel, pdfEngine, blocks, randomize, countdownHidden, overallLimitMinutes],
  );
  const defaultConfig = useMemo(
    () => ({
      ...createDefaultStudyTemplate(defaultModel?.id ?? ""),
      pdfEngine:
        defaultModel && !defaultModel.inputModalities.includes("file")
          ? ("cloudflare-ai" as const)
          : ("native" as const),
    }),
    [defaultModel],
  );

  function applyConfig(config: StudyTemplateConfig, catalog: CatalogModel[]) {
    setPdfEngine(config.pdfEngine);
    setBlocks(config.blocks);
    setRandomize(config.randomize);
    setCountdownHidden(config.countdownHidden);
    setOverallLimitMinutes(
      config.overallTimeLimitSeconds ? String(Math.round(config.overallTimeLimitSeconds / 60)) : "",
    );
    const match = catalog.find((model) => model.id === config.modelId);
    if (match) {
      setSelectedModel(match);
      setModelSearch(match.name);
    }
    return Boolean(match);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/templates").then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load templates.");
        return payload as {
          templates: StudyTemplateSummary[];
          draft: StudyTemplateConfig | null;
        };
      }),
      completeOpenRouterOAuth().catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "Unable to connect the OpenRouter key.",
          );
        }
        return null;
      }),
    ])
      .then(([stored, connected]) => {
        if (!active) return;
        const catalog = FEATURED_MODELS;
        if (connected && "key" in connected) {
          void loadModelCatalog(connected.key, "oauth");
        } else {
          const browserKey = readBrowserOpenRouterKey(username);
          if (browserKey) {
            void loadModelCatalog(browserKey.key, "oauth");
          }
        }
        const defaultPreferred = preferredModel(catalog);
        setDefaultModel(defaultPreferred);
        setDefaultModelSearch(defaultPreferred?.name ?? "");
        setTemplates(stored.templates ?? []);

        // Preserve real edits, but replace the untouched starter used before the public
        // eight-question template existed.
        const legacyDraft = stored.draft && isLegacyStarterTemplate(stored.draft);
        const draft = legacyDraft
          ? createDefaultStudyTemplate(stored.draft?.modelId ?? "")
          : stored.draft;
        const restoredModel = draft ? applyConfig(draft, catalog) : false;
        if (!restoredModel && catalog.length) {
          const preferred = preferredModel(catalog);
          setSelectedModel(preferred);
          setModelSearch(preferred?.name ?? "");
        }
        setTemplateStatus(
          legacyDraft
            ? "Updated the old starter configuration to the standard eight-question template."
            : stored.draft
              ? "Restored your last configuration."
              : "Starting from the standard default template. Edit any setting below.",
        );
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Unable to initialize.");
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
    const query =
      modelSearch === selectedModel?.name ? "" : modelSearch.trim().toLowerCase();
    if (!query) {
      return FEATURED_MODEL_IDS.flatMap((id) => {
        const model = models.find((candidate) => candidate.id === id);
        return model ? [model] : [];
      });
    }
    return models
      .filter(
        (model) =>
          model.name.toLowerCase().includes(query) ||
          model.id.toLowerCase().includes(query),
      )
      .slice(0, 60);
  }, [modelSearch, models, selectedModel]);

  const filteredDefaultModels = useMemo(() => {
    const query =
      defaultModelSearch === defaultModel?.name
        ? ""
        : defaultModelSearch.trim().toLowerCase();
    if (!query) {
      return FEATURED_MODEL_IDS.flatMap((id) => {
        const model = models.find((candidate) => candidate.id === id);
        return model ? [model] : [];
      });
    }
    return models
      .filter(
        (model) =>
          model.name.toLowerCase().includes(query) ||
          model.id.toLowerCase().includes(query),
      )
      .slice(0, 60);
  }, [defaultModel, defaultModelSearch, models]);

  async function loadModelCatalog(
    requestedKey: string,
    requestedSource: KeySource,
  ) {
    if (!requestedKey) {
      setError("Paste or connect an OpenRouter API key before loading models.");
      return;
    }
    setLoadingModels(true);
    setError("");
    try {
      const keyForRequest =
        requestedSource === "oauth"
          ? (await validateBrowserOpenRouterKey()).key
          : requestedKey;
      const response = await fetch("/api/openrouter/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey: keyForRequest, keySource: requestedSource }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load models.");
      const catalog = payload.models as CatalogModel[];
      setModels(catalog);
      if (!defaultModel) {
        const preferred = preferredModel(catalog);
        setDefaultModel(preferred);
        setDefaultModelSearch(preferred?.name ?? "");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load models.");
    } finally {
      setLoadingModels(false);
    }
  }

  const refreshCatalog = useCallback(async () => {
    const [setsResult, attemptsResult, mineResult] = await Promise.allSettled([
      fetch("/api/question-sets").then((response) => response.json()),
      fetch("/api/attempts").then((response) => response.json()),
      fetch("/api/attempts/mine").then((response) => response.json()),
    ]);
    if (setsResult.status === "fulfilled" && setsResult.value.sets) {
      setSavedSets(setsResult.value.sets as QuestionSetListEntry[]);
    }
    if (attemptsResult.status === "fulfilled" && attemptsResult.value.attempts) {
      setAttemptList(attemptsResult.value.attempts as AttemptListEntry[]);
    }
    if (mineResult.status === "fulfilled" && mineResult.value.attempts) {
      setMyAssessments(mineResult.value.attempts as AttemptListEntry[]);
    }
  }, []);

  // Reload the lists whenever a browsing tab is opened, so a set generated moments ago and
  // an attempt just answered on this laptop both appear without a page refresh.
  useEffect(() => {
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
      [entry.setLabel, entry.paperName, entry.status, entry.id, entry.takerUsername ?? ""].some(
        (field) => field.toLowerCase().includes(query),
      ),
    );
  }, [catalogSearch, attemptList]);
  const visibleMyAssessments = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return myAssessments;
    return myAssessments.filter((entry) =>
      [entry.setLabel, entry.paperName, entry.status, entry.id].some((field) =>
        field.toLowerCase().includes(query),
      ),
    );
  }, [catalogSearch, myAssessments]);

  async function copyRecentAssessmentLink(set: QuestionSetListEntry) {
    setSharingSetId(set.id);
    setShareError("");
    try {
      let shared = shareLinks[set.id];
      if (!shared) {
        const response = await fetch(
          `/api/question-sets/${encodeURIComponent(set.id)}/share`,
          { method: "POST" },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to create an assessment link.");
        }
        shared = {
          url: new URL(String(payload.participantPath), window.location.origin).toString(),
        };
        setShareLinks((current) => ({ ...current, [set.id]: shared! }));
        await refreshCatalog();
      }
      await navigator.clipboard.writeText(shared.url);
      setCopiedSetId(set.id);
      window.setTimeout(() => setCopiedSetId(""), 2_000);
    } catch (caught) {
      setShareError(
        caught instanceof Error ? caught.message : "Unable to copy the assessment link.",
      );
    } finally {
      setSharingSetId("");
    }
  }

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
      await showSummary(payload.attemptId as string);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load question set.");
    } finally {
      setWorking(false);
    }
  }

  /**
   * Deleting a set cascades to its attempts and their answers, so the confirmation names
   * exactly what goes with it rather than asking a bare "are you sure".
   */
  async function deleteSet(set: QuestionSetListEntry) {
    const consequence = set.attemptCount
      ? `\n\nThis also deletes its ${set.attemptCount} ${
          set.attemptCount === 1 ? "attempt" : "attempts"
        } and every answer and timing recorded in them.`
      : "\n\nIt has no attempts, so no response data is affected.";
    if (!window.confirm(`Delete the set “${set.label}”?${consequence}\n\nThis cannot be undone.`)) {
      return;
    }
    setError("");
    try {
      const response = await fetch(`/api/question-sets/${encodeURIComponent(set.id)}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete the set.");
      await refreshCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the set.");
    }
  }

  async function deleteAttemptRow(entry: AttemptListEntry) {
    const state =
      entry.status === "graded"
        ? `It is graded${entry.score === null ? "" : ` at ${entry.score}%`}.`
        : `${entry.answeredCount} of ${entry.totalQuestions} questions are answered.`;
    if (
      !window.confirm(
        `Delete this attempt of “${entry.setLabel}”?\n\n${state} Its answers and timings will be removed. The question set itself is kept.\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    setError("");
    try {
      const response = await fetch(`/api/attempts/${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete the attempt.");
      await refreshCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the attempt.");
    }
  }

  /**
   * Clears an attempt's progress so the same link can be run again from the start.
   *
   * The confirmation spells out what is destroyed rather than asking a bare "are you sure",
   * because none of it is recoverable and a graded attempt loses a whole session's data. It also
   * says what is *kept* — the link and the question order — since that is the reason to reset
   * rather than delete.
   */
  async function resetAttemptRow(row: {
    id: string;
    setLabel: string;
    status: string;
    score: number | null;
    answeredCount: number;
    totalQuestions: number;
  }) {
    const state =
      row.status === "graded"
        ? `It is graded${row.score === null ? "" : ` at ${row.score}%`}. That score and every recorded answer, timing and piece of grader feedback will be destroyed.`
        : `${row.answeredCount} of ${row.totalQuestions} questions are answered. Those answers and their timings will be destroyed.`;
    if (
      !window.confirm(
        `Reset this attempt of \u201c${row.setLabel}\u201d?\n\n${state}\n\nThe question order stays the same, and the attempt can be run again from the beginning.\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    setResettingId(row.id);
    setError("");
    try {
      const response = await fetch(`/api/attempts/${encodeURIComponent(row.id)}/reset`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to reset the attempt.");
      await refreshCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reset the attempt.");
    } finally {
      setResettingId("");
    }
  }

  /**
   * Arms or disarms a participant link from the list, so several links mailed out in advance
   * can be enabled at the start of a session without opening each attempt.
   */
  async function toggleAttemptLink(entry: { id: string; linkEnabled: boolean }) {
    setTogglingLinkId(entry.id);
    setError("");
    try {
      const response = await fetch(`/api/attempts/${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkEnabled: !entry.linkEnabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to update the link.");
      const linkEnabled = payload.linkEnabled as boolean;
      setAttemptList((current) =>
        current.map((row) => (row.id === entry.id ? { ...row, linkEnabled } : row)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the link.");
    } finally {
      setTogglingLinkId("");
    }
  }

  /** Shows whichever screen an attempt is due: its landing page, or the current question. */
  function showEntry(entry: AttemptEntry) {
    if (entry.kind !== "closed") pushLayer("assessment");
    if (entry.kind === "intro") {
      setAttempt(null);
      setIntro(entry.intro);
    } else if (entry.kind === "question") {
      setIntro(null);
      setAttempt(entry.attempt);
    } else if (entry.kind === "result") {
      setIntro(null);
      setAttempt(null);
      setResult(entry.result);
    } else if (entry.kind === "pending") {
      setIntro(null);
      setAttempt(null);
      setOutline(null);
      setError("This assessment is awaiting evaluation.");
    } else {
      setError(entry.message);
    }
  }

  /**
   * Opens one attempt from its plan page. Lands on the Start page for an attempt nobody has
   * begun, and resumes mid-question for one already under way, whose clock is already running.
   */
  async function beginAttempt(attemptId: string) {
    const entry = await loadAttemptEntry(attemptId);
    showEntry(entry);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Start pressed on a landing page: this is the request that stamps question one's clock. */
  async function startFromIntro(attemptId: string) {
    const entry = await serveAttempt(attemptId);
    showEntry(entry);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * Records a screen opening on top of the dashboard.
   *
   * The assessment layer covers the landing page, the questions and the results together: they are
   * one act on one attempt, and going "back" from a graded result to the question that produced it
   * would mean nothing. Moving between them replaces the screen without adding an entry, which is
   * what keeps the stack and the history the same depth.
   */
  const pushLayer = useCallback((kind: "overview" | "outline" | "assessment") => {
    if (kind === "assessment" && layers.current.includes("assessment")) return;
    layers.current = [...layers.current, kind];
    window.history.pushState({ rcDepth: layers.current.length }, "");
  }, []);

  /** Closes the topmost screen. Precedence matches the render order, so it peels one layer. */
  const closeTopLayer = useCallback(() => {
    const kind = layers.current[layers.current.length - 1];
    layers.current = layers.current.slice(0, -1);
    if (kind === "overview") {
      setSetOverview(null);
    } else if (kind === "outline") {
      setOutline(null);
    } else {
      setIntro(null);
      setAttempt(null);
      setResult(null);
    }
  }, []);

  /**
   * Unwinds to whatever depth the history entry we landed on describes. A loop rather than a single
   * step, because one `history.go(-n)` traversal fires a single popstate.
   */
  useEffect(() => {
    function onPop(event: PopStateEvent) {
      const target = (event.state as { rcDepth?: number } | null)?.rcDepth ?? 0;
      while (layers.current.length > target) closeTopLayer();
      if (layers.current.length === 0) void refreshCatalog();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [closeTopLayer, refreshCatalog]);

  /**
   * What the in-app Back buttons do. Rewinding the history rather than clearing state directly
   * means both routes into the dashboard run through the same popstate path, so the stack cannot
   * be left deeper than the history or the other way round.
   */
  const exitToDashboard = useCallback(() => {
    if (layers.current.length > 0) {
      window.history.go(-layers.current.length);
      return;
    }
    void refreshCatalog();
  }, [refreshCatalog]);

  /** Opens a saved set's contents without creating an attempt to see them. */
  async function showSetOverview(id: string) {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/question-sets/${encodeURIComponent(id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load the set.");
      setSetOverview(payload.overview as QuestionSetOverview);
      pushLayer("overview");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the set.");
    } finally {
      setWorking(false);
    }
  }

  /** Every entry point lands on the researcher-facing plan, never straight into a question. */
  async function showSummary(attemptId: string) {
    const response = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/outline`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load the attempt summary.");
    setOutline(payload.outline as AttemptOutline);
    pushLayer("outline");
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
        body: JSON.stringify({ name: templateName, config: currentConfig, workflowType }),
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
        workflowType: WorkflowType;
        config: StudyTemplateConfig;
      };
      setWorkflowType(template.workflowType);
      if (template.workflowType === "conference") setSetName(template.name);
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

  function changeWorkflow(next: WorkflowType) {
    if (next === workflowType) return;
    const selected = templates.find((template) => template.id === templateId);
    setWorkflowType(next);
    if (selected && selected.workflowType !== next) {
      setTemplateId("");
      setTemplateStatus(
        `Cleared “${selected.name}” because it uses the ${selected.workflowType} workflow.`,
      );
    }
  }

  async function updateConferenceSharing(id: string, enabled: boolean) {
    const response = await fetch(
      `/api/templates/${encodeURIComponent(id)}/conference-share`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    );
    const payload = (await response.json()) as {
      error?: string;
      conferenceShareToken?: string | null;
      participantPath?: string | null;
    };
    if (!response.ok) throw new Error(payload.error ?? "Unable to update sharing.");
    setTemplates((current) =>
      current.map((template) =>
        template.id === id
          ? { ...template, conferenceShareToken: payload.conferenceShareToken ?? null }
          : template,
      ),
    );
    if (payload.participantPath) {
      const link = `${window.location.origin}${payload.participantPath}`;
      await navigator.clipboard.writeText(link);
      setTemplateStatus("Conference template saved. Examinee link published and copied.");
    } else {
      setTemplateStatus("Conference link revoked.");
    }
  }

  async function setConferenceSharing(enabled: boolean) {
    if (!templateId) return;
    setError("");
    setTemplateStatus("");
    try {
      await updateConferenceSharing(templateId, enabled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update sharing.");
    }
  }

  async function createConferenceTemplate(
    event: FormEvent<HTMLFormElement>,
    config: StudyTemplateConfig,
  ) {
    event.preventDefault();
    if (!setName.trim()) return setError("Give the test set a name.");
    if (!config.modelId) return setError("Choose an OpenRouter model.");
    if (config.blocks.length === 0) return setError("Add at least one question type.");
    setWorking(true);
    setError("");
    setTemplateStatus("");
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: setName,
          config,
          workflowType: "conference",
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        template?: StudyTemplateSummary;
      };
      if (!response.ok || !payload.template) {
        throw new Error(payload.error ?? "Unable to save the conference template.");
      }
      const saved = payload.template;
      setTemplates((current) => [saved, ...current.filter((one) => one.id !== saved.id)]);
      setTemplateId(saved.id);
      setSetName(saved.name);
      await updateConferenceSharing(saved.id, true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to publish the conference template.",
      );
    } finally {
      setWorking(false);
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

  function resetCustomTemplate() {
    const model = selectedModel ?? preferredModel(models);
    applyConfig(createDefaultStudyTemplate(model?.id ?? ""), models);
    setTemplateId("");
    setError("");
    setTemplateStatus(
      "Reset to the standard eight-question template. Your selected model was retained.",
    );
  }

  function clearBlocks() {
    if (blocks.length === 0) return;
    const plural = blocks.length === 1 ? "card" : "cards";
    if (
      !window.confirm(
        `Remove all ${blocks.length} question type ${plural}?\n\nTheir prompts, counts, limits and warm-up flags are lost, and the autosaved draft updates immediately. Reload a saved study set template to get a configuration back.\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    setBlocks([]);
  }

  function updateBlock(id: string, patch: Partial<QuestionBlockConfig>) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === id ? ({ ...block, ...patch } as QuestionBlockConfig) : block,
      ),
    );
  }

  async function generateSet(
    event: FormEvent<HTMLFormElement>,
    config: StudyTemplateConfig,
  ) {
    event.preventDefault();
    if (!config.modelId) return setError("No compatible OpenRouter model is available.");
    if (config.blocks.length === 0) return setError("Add at least one question type.");
    const form = new FormData(event.currentTarget);
    // Checked before the upload starts, not after: the server can only refuse an oversized PDF
    // once it has arrived, and over a tunnel that is minutes of waiting for a no.
    const paper = form.get("paper");
    if (paper instanceof File && paper.size > MAX_PDF_BYTES) {
      setError("");
      return setPaperError(pdfTooLargeMessage(paper.size));
    }
    setPaperError("");
    setWorking(true);
    setGenerationStatus("Queued for generation…");
    setGenerationNotice("");
    setError("");
    form.set("modelId", config.modelId);
    form.set("pdfEngine", config.pdfEngine);
    form.set("blocks", JSON.stringify(config.blocks));
    form.set("randomize", String(config.randomize));
    form.set("countdownHidden", String(config.countdownHidden));
    form.set(
      "overallTimeLimitSeconds",
      config.overallTimeLimitSeconds === null
        ? ""
        : String(config.overallTimeLimitSeconds),
    );
    form.set("name", setName);
    form.set("workflowType", "course");
    if (mode === "custom" && templateId) form.set("sourceTemplateId", templateId);
    let jobId = "";
    try {
      const response = await fetch("/api/question-sets", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to generate questions.");
      jobId = String(payload.jobId ?? "");
      if (!jobId) throw new Error("The generation job was not created.");
      let attemptId = "";
      while (!attemptId) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const jobResponse = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        const jobPayload = await jobResponse.json();
        if (!jobResponse.ok) throw new Error(jobPayload.error ?? "Unable to check generation.");
        const job = jobPayload.job as {
          status: string;
          progressCurrent: number;
          progressTotal: number;
          error?: string;
          result?: { attemptId?: string };
        };
        setGenerationStatus(
          job.status === "running"
            ? `Generating block ${Math.min(job.progressCurrent + 1, job.progressTotal)} of ${job.progressTotal}…`
            : "Waiting for a generation worker…",
        );
        if (job.status === "failed") throw new Error(job.error ?? "Question generation failed.");
        if (job.status === "completed") {
          attemptId = String(job.result?.attemptId ?? "");
          if (!attemptId) throw new Error("Generation completed without an attempt.");
        }
      }
      await refreshCatalog();
      setFailedGenerationJobId("");
      setGenerationNotice(
        "Question set generated. Create and copy its reusable assessment link from Recent question sets.",
      );
    } catch (caught) {
      if (jobId) setFailedGenerationJobId(jobId);
      setError(caught instanceof Error ? caught.message : "Question generation failed.");
    } finally {
      setWorking(false);
      setGenerationStatus("");
    }
  }

  async function retryGeneration() {
    if (!failedGenerationJobId) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(failedGenerationJobId)}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to retry generation.");
      let attemptId = "";
      while (!attemptId) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const jobResponse = await fetch(
          `/api/jobs/${encodeURIComponent(failedGenerationJobId)}`,
        );
        const jobPayload = await jobResponse.json();
        if (!jobResponse.ok) throw new Error(jobPayload.error ?? "Unable to check generation.");
        const job = jobPayload.job as {
          status: string;
          error?: string;
          result?: { attemptId?: string };
        };
        if (job.status === "failed") throw new Error(job.error ?? "Question generation failed.");
        if (job.status === "completed") {
          attemptId = String(job.result?.attemptId ?? "");
          if (!attemptId) throw new Error("Generation completed without an attempt.");
        }
      }
      await refreshCatalog();
      setGenerationNotice("Question set generated. Its sharing link is available on the right.");
      setFailedGenerationJobId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to retry generation.");
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
      await showSummary(payload.attemptId as string);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load question set.");
    } finally {
      setWorking(false);
    }
  }

  if (result) return <ResultView result={result} onBack={exitToDashboard} />;
  if (intro) {
    return (
      <AttemptIntroPage
        intro={intro}
        onStart={() => startFromIntro(intro.attemptId)}
      />
    );
  }
  if (attempt) {
    return (
      <QuizWorkspace
        key={attempt.attemptId}
        initialAttempt={attempt}
        onBack={exitToDashboard}
      />
    );
  }
  if (setOverview) {
    return (
      <SetOverview
        overview={setOverview}
        onSaved={({ name, overallTimeLimitSeconds }) => {
          // Keep the open page and the list behind it in step without a refetch of either.
          setSetOverview((current) =>
            current
              ? { ...current, name, label: name || current.paperName, overallTimeLimitSeconds }
              : current,
          );
          setSavedSets((current) =>
            current.map((entry) =>
              entry.id === setOverview.id
                ? { ...entry, name, label: name || entry.paperName }
                : entry,
            ),
          );
        }}
        onBack={exitToDashboard}
      />
    );
  }
  if (outline) {
    return (
      <AttemptSummary
        outline={outline}
        onStart={beginAttempt}
        onResult={(next) => {
          pushLayer("assessment");
          setResult(next);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onBack={exitToDashboard}
      />
    );
  }

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="brand-mark">G</span>
        greCAPTCHA
        <span className="account-name">Signed in as {username}</span>
        <button
          className="sign-out account-action"
          type="button"
          onClick={async () => {
            await fetch("/api/session", { method: "DELETE" });
            window.location.href = "/login";
          }}
        >
          Sign out
        </button>
      </div>
      <section>
        <p className="eyebrow">Authorship understanding assessment</p>
        <h1>greCAPTCHA Demo</h1>
        <p className="lede">
          You can generate a question set from a paper in the &lsquo;New question set&rsquo; tab.
          Once you have generated a question set, copy the link on the right to share the exam
          with someone. To see attempts completed on your exams, open the &lsquo;My tests&rsquo;
          tab. You can also trigger grading of attempts from the My tests tab.
        </p>
        <p className="lede">
          The &lsquo;My assessments&rsquo; tab shows assessments you have taken. Return there to
          continue an assessment, check whether it has been graded, or review your grades and
          feedback once they are available.
        </p>
      </section>

      <div className="dashboard-layout">
      <div className="dashboard-main">
      <section className="dashboard-workflow" aria-labelledby="workflow-heading">
        <div>
          <span className="field-label" id="workflow-heading">Workflow</span>
          <p className="hint">Choose who supplies the OpenRouter key for generation and grading.</p>
        </div>
        <div className="workflow-toggle" role="radiogroup" aria-label="Assessment workflow">
          <button
            type="button"
            role="radio"
            aria-checked={workflowType === "course"}
            className={workflowType === "course" ? "active" : ""}
            onClick={() => changeWorkflow("course")}
          >
            Course
            <small>Professor key · automatic grading</small>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={workflowType === "conference"}
            className={workflowType === "conference" ? "active" : ""}
            onClick={() => changeWorkflow("conference")}
          >
            Conference
            <small>Examinee supplies the key</small>
          </button>
        </div>
      </section>
      <div className="dashboard-navigation">
        <div className="mode-tabs" role="tablist" aria-label="Dashboard section">
          <button
            type="button"
            className={mode === "default" ? "active" : ""}
            onClick={() => {
              setMode("default");
              setAdvancedOpen(false);
            }}
          >
            New question set
          </button>
          <button
            type="button"
            className={mode === "resume" ? "active" : ""}
            onClick={() => {
              setMode("resume");
              setAdvancedOpen(false);
            }}
          >
            My tests
          </button>
          <button
            type="button"
            className={mode === "mine" ? "active" : ""}
            onClick={() => {
              setMode("mine");
              setAdvancedOpen(false);
            }}
          >
            My assessments
          </button>
        </div>
        <div className="advanced-navigation">
          <button
            className={`secondary advanced-button ${
              mode === "custom" || mode === "load" ? "active" : ""
            }`}
            type="button"
            aria-expanded={advancedOpen}
            aria-haspopup="menu"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            Advanced
          </button>
          {advancedOpen && (
            <div className="advanced-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMode("custom");
                  setAdvancedOpen(false);
                }}
              >
                New question set from new template
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMode("load");
                  setAdvancedOpen(false);
                }}
              >
                Saved question sets
              </button>
            </div>
          )}
        </div>
      </div>

      {generationNotice && (
        <p className="template-status dashboard-notice" role="status">
          {generationNotice}
        </p>
      )}
      {mode !== "custom" && templateStatus && (
        <p className="template-status dashboard-notice" role="status">
          {templateStatus}
        </p>
      )}

      {mode === "custom" && (
        <section className="card template-card">
          <div className="template-heading">
            <div>
              <span className="field-label">Study set template</span>
              <p className="hint">
                {workflowType === "conference"
                  ? "Load an existing conference template or configure a new one below."
                  : "Everything below except the PDF and the contribution statement. Your current setup is saved automatically and restored on the next visit."}
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
            {workflowType === "course" && (
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
            )}
            <div className="template-buttons">
              <button
                className="secondary"
                type="button"
                onClick={resetCustomTemplate}
              >
                Reset to default template
              </button>
              {workflowType === "course" && (
                <button
                  className="secondary"
                  type="button"
                  disabled={!templateName.trim()}
                  onClick={saveTemplate}
                >
                  Save template
                </button>
              )}
              <button
                className="secondary"
                type="button"
                disabled={!templateId}
                onClick={deleteTemplate}
              >
                Delete selected
              </button>
              {workflowType === "conference" && templateId && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    void setConferenceSharing(
                      !templates.find((template) => template.id === templateId)
                        ?.conferenceShareToken,
                    )
                  }
                >
                  {templates.find((template) => template.id === templateId)
                    ?.conferenceShareToken
                    ? "Revoke conference link"
                    : "Publish and copy conference link"}
                </button>
              )}
            </div>
          </div>
          {templateStatus && <p className="template-status">{templateStatus}</p>}
        </section>
      )}

      {mode === "resume" || mode === "load" || mode === "mine" ? (
        <section className="card form-card">
          <div className="field">
            <label htmlFor="catalogSearch">
              {mode === "load"
                ? "Search saved sets"
                : mode === "mine"
                  ? "Search my assessments"
                  : "Search attempts"}
            </label>
            <input
              className="control"
              id="catalogSearch"
              value={catalogSearch}
              placeholder={
                mode === "load"
                  ? "Filter by set name, paper, or model"
                  : "Filter by set name, paper, username, or status"
              }
              onChange={(event) => setCatalogSearch(event.target.value)}
            />
          </div>

          <div className="catalog-toolbar">
            <span className="hint">
              {mode === "load"
                ? `${savedSets.length} saved ${savedSets.length === 1 ? "set" : "sets"}`
                : mode === "mine"
                  ? `${myAssessments.length} ${myAssessments.length === 1 ? "assessment" : "assessments"}`
                  : `${attemptList.length} ${attemptList.length === 1 ? "attempt" : "attempts"} recorded`}
            </span>
            {mode === "resume" && (
              <button
                className="secondary"
                type="button"
                disabled={attemptList.length === 0}
                onClick={() => {
                  window.location.href = "/api/export/answers";
                }}
              >
                Export all attempts as CSV
              </button>
            )}
          </div>

          {mode === "load" ? (
            <>
              <div className="toggle-group">
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={randomize}
                    onChange={(event) => setRandomize(event.target.checked)}
                  />
                  Randomize question order for this attempt
                </label>
                <CountdownToggle hidden={countdownHidden} onChange={setCountdownHidden} />
              </div>
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
                      <strong>{set.label}</strong>
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
                        disabled={sharingSetId === set.id}
                        onClick={() => void copyRecentAssessmentLink(set)}
                      >
                        {sharingSetId === set.id
                          ? "Creating link…"
                          : copiedSetId === set.id
                            ? "Link copied"
                            : shareLinks[set.id]
                              ? "Copy share link"
                              : "Create and copy share link"}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={working}
                        onClick={() => void showSetOverview(set.id)}
                      >
                        Overview
                      </button>
                      <button
                        className="secondary danger"
                        type="button"
                        onClick={() => void deleteSet(set)}
                      >
                        Delete
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
          ) : mode === "mine" ? (
            <div className="catalog-list">
              {visibleMyAssessments.length === 0 && (
                <p className="hint catalog-empty">
                  {myAssessments.length
                    ? "No assessment matches that search."
                    : "You have not claimed any shared assessments yet."}
                </p>
              )}
              {visibleMyAssessments.map((entry) => (
                <article className="catalog-row" key={entry.id}>
                  <div className="catalog-main">
                    <strong>{entry.setLabel}</strong>
                    <span className="catalog-meta">
                      {entry.status === "graded"
                        ? `Graded${entry.score === null ? "" : ` at ${entry.score}%`}`
                        : entry.status === "evaluating"
                          ? "Evaluation running"
                        : entry.status === "submitted"
                          ? "Awaiting evaluation"
                          : "In progress"}{" "}
                      · {new Date(entry.completedAt ?? entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => {
                      window.location.href = `/attempt/${encodeURIComponent(entry.id)}`;
                    }}
                  >
                    {entry.status === "graded"
                      ? "View grade"
                      : entry.status === "evaluating"
                        ? "Check evaluation"
                      : entry.status === "submitted"
                        ? "Check status"
                        : "Continue"}
                  </button>
                </article>
              ))}
            </div>
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
                      <div className="catalog-title-row">
                        <strong>{entry.setLabel}</strong>
                        {entry.takerUsername && (
                          <span className="pill">Taken by {entry.takerUsername}</span>
                        )}
                      </div>
                      <span className="catalog-meta">
                        {entry.answeredCount} of {entry.totalQuestions} answered ·{" "}
                        {entry.status === "graded"
                          ? `graded${entry.score === null ? "" : ` at ${entry.score}%`}`
                          : entry.status === "submitted"
                            ? "awaiting evaluation"
                            : "in progress"}
                        {entry.randomize && " · randomized"} ·{" "}
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="catalog-actions">
                      <button
                        className="secondary danger"
                        type="button"
                        onClick={() => void deleteAttemptRow(entry)}
                      >
                        Delete
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={resettingId === entry.id}
                        title="Clear this attempt's answers and run it again from the start. The question order is kept."
                        onClick={() => void resetAttemptRow(entry)}
                      >
                        {resettingId === entry.id ? "Resetting…" : "Reset"}
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={working}
                        onClick={() => void openAttempt(entry.id)}
                      >
                        {entry.status === "graded"
                          ? "Open"
                          : entry.status === "submitted"
                            ? "Evaluate"
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
        <form
          className="card form-card"
          onSubmit={(event) => {
            const config = mode === "default" ? defaultConfig : currentConfig;
            return workflowType === "conference"
              ? createConferenceTemplate(event, config)
              : generateSet(event, config);
          }}
        >
          {workflowType === "course" && <ProfessorOpenRouterPanel />}
          <div className="form-section">
            {mode !== "default" && workflowType === "course" && (
              <div className="section-heading">
                <div>
                  <span className="field-label">This paper</span>
                  <p className="hint">
                    Specific to one manuscript and one claimed author. Everything below is
                    reusable, so the same question configuration can be run against any paper.
                  </p>
                </div>
              </div>
            )}
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="setName">
                  Test set name
                  <FieldHint
                    text={
                      workflowType === "conference"
                        ? "Names the reusable template shown to examinees who open its invitation link."
                        : "Identifies this set in the saved-set list. Leave blank to use the PDF filename. You can rename it later."
                    }
                  />
                </label>
                <input
                  className="control"
                  id="setName"
                  value={setName}
                  maxLength={120}
                  placeholder="e.g. My test set"
                  onChange={(event) => setSetName(event.target.value)}
                />
              </div>
              {workflowType === "course" && (
                <>
                  <div className="field full">
                    <label htmlFor="paper">Manuscript PDF</label>
                    <input
                      className="control file-control"
                      id="paper"
                      name="paper"
                      type="file"
                      accept="application/pdf,.pdf"
                      required
                      // Judged the moment a file is picked, so the size is known before the
                      // configuration below is filled in rather than after pressing Generate.
                      onChange={(event) => {
                        const picked = event.target.files?.[0];
                        setPaperError(
                          picked && picked.size > MAX_PDF_BYTES
                            ? pdfTooLargeMessage(picked.size)
                            : "",
                        );
                      }}
                    />
                    <small>PDF only, up to {MAX_PDF_LABEL}.</small>
                    {paperError && (
                      <p className="error" role="alert">
                        {paperError}
                      </p>
                    )}
                  </div>
                  <div className="field full">
                    <label htmlFor="contributions">
                      What material are we testing the student on?
                    </label>
                    {/* No length constraint, blank included: with no statement the generator is told
                        there is no declared scope and covers the whole manuscript. */}
                    <textarea
                      className="control"
                      id="contributions"
                      name="contributions"
                      placeholder="Enter the sections of the lecture-notes PDF to cover, or describe which aspects of the course-project PDF the assessment should address."
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {mode === "custom" && (
          <div className="form-section">
            <div className="section-heading">
              <div>
                <span className="field-label">Question configuration</span>
                <p className="hint">
                  Saved and restored by a study set template, independent of the manuscript.
                </p>
              </div>
            </div>
            <div className="form-grid">
            <div className="field full">
              <span className="field-label field-label-row">
                Generator and Evaluator model
                <FieldHint text="This model generates the questions and grades free-response answers. Click for featured choices or type to search every model available through OpenRouter." />
              </span>
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
                  placeholder={
                    loadingModels ? "Loading models..." : "Click or type to search all models"
                  }
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
              <small>
                Click to choose a featured model, or type to search the full OpenRouter catalog.
              </small>
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

            <div className="field">
              <label htmlFor="overallLimit">
                Overall time limit
                <span className="label-note">minutes</span>
                <FieldHint text="Enforced, unlike the per-card soft limits: once the budget is spent no further question is served and the attempt is graded. Counts the time questions were actually open, so pausing a session costs nothing. Leave blank for no limit." />
              </label>
              <input
                className="control"
                id="overallLimit"
                type="number"
                min={1}
                max={360}
                step={1}
                value={overallLimitMinutes}
                placeholder="No limit"
                onChange={(event) => setOverallLimitMinutes(event.target.value)}
              />
            </div>

            <div className="toggle-group full">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={randomize}
                  onChange={(event) => setRandomize(event.target.checked)}
                />
                Randomize question order for the first attempt
              </label>
              <CountdownToggle hidden={countdownHidden} onChange={setCountdownHidden} />
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
                  <button
                    className="secondary danger"
                    type="button"
                    disabled={blocks.length === 0}
                    onClick={clearBlocks}
                  >
                    Clear all
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
            </div>
          </div>
          )}

          {mode === "default" && (
            <div className="default-template-summary">
              <div className="field">
                <span className="field-label field-label-row">
                  Generator and Evaluator model
                  <FieldHint text="This model generates the questions and grades free-response answers. Click for featured choices or type to search every model available through OpenRouter." />
                </span>
                <div className="model-picker">
                  <input
                    className="search-control"
                    value={defaultModelSearch}
                    onChange={(event) => {
                      setDefaultModelSearch(event.target.value);
                      setDefaultModelPickerOpen(true);
                      if (event.target.value !== defaultModel?.name) setDefaultModel(null);
                    }}
                    onFocus={() => setDefaultModelPickerOpen(true)}
                    onBlur={() =>
                      window.setTimeout(() => setDefaultModelPickerOpen(false), 150)
                    }
                    placeholder={
                      loadingModels ? "Loading models..." : "Click or type to search all models"
                    }
                    disabled={loadingModels}
                  />
                  {defaultModelPickerOpen && !loadingModels && (
                    <ul className="model-results">
                      {filteredDefaultModels.map((model) => (
                        <li key={model.id}>
                          <button
                            className="model-option"
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setDefaultModel(model);
                              setDefaultModelSearch(model.name);
                              setDefaultModelPickerOpen(false);
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
                  <small>
                    Click to choose a featured model, or type to search the full OpenRouter
                    catalog.
                  </small>
              </div>
            </div>
          )}

          {error && <p className="error" role="alert">{error}</p>}
          <div className="submit-row">
            {workflowType === "course" && failedGenerationJobId && (
              <button
                className="secondary"
                type="button"
                disabled={working}
                onClick={() => void retryGeneration()}
              >
                Run interrupted generation again
              </button>
            )}
            <button
              className="primary"
              type="submit"
              disabled={
                working ||
                (mode === "default"
                  ? !defaultModel
                  : !selectedModel || blocks.length === 0) ||
                (workflowType === "conference" && !setName.trim())
              }
            >
              {working
                ? workflowType === "conference"
                  ? "Publishing conference link…"
                  : generationStatus || "Preparing upload…"
                : workflowType === "conference"
                  ? "Create and copy conference link"
                  : "Generate question set"}
            </button>
          </div>
        </form>
      )}
      </div>
      <aside className="card recent-sets">
        <div className="recent-sets-heading">
          <div>
            <p className="eyebrow">Quick access</p>
            <h2>Recent question sets</h2>
          </div>
          <span className="pill">{Math.min(savedSets.length, 5)} of 5</span>
        </div>
        {savedSets.length === 0 ? (
          <p className="hint">Your five most recently generated question sets will appear here.</p>
        ) : (
          <div className="recent-set-list">
            {savedSets.slice(0, 5).map((set) => (
              <article className="recent-set" key={set.id}>
                <strong>{set.label}</strong>
                <span>
                  {set.questionCount} {set.questionCount === 1 ? "question" : "questions"} ·{" "}
                  {new Date(set.createdAt).toLocaleDateString()}
                </span>
                {shareLinks[set.id] && (
                  <div className="recent-link">
                    <input
                      className="control"
                      aria-label={`Assessment link for ${set.label}`}
                      value={shareLinks[set.id].url}
                      readOnly
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <small>Reusable link · one attempt per signed-in account</small>
                  </div>
                )}
                <button
                  className="secondary"
                  type="button"
                  disabled={sharingSetId === set.id}
                  onClick={() => void copyRecentAssessmentLink(set)}
                >
                  {sharingSetId === set.id
                    ? "Creating link…"
                    : copiedSetId === set.id
                      ? "Link copied"
                      : shareLinks[set.id]
                        ? "Copy link again"
                        : "Create and copy reusable link"}
                </button>
              </article>
            ))}
          </div>
        )}
        {shareError && (
          <p className="error recent-share-error" role="alert">
            {shareError}
          </p>
        )}
      </aside>
      </div>
    </main>
  );
}
