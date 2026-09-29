"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import {
  createDefaultStudyBlocks,
  createDefaultStudyTemplate,
  isLegacyStarterTemplate,
} from "@/lib/default-study-template";
import { errorFromPayload, isOpenRouterError } from "@/lib/openrouter-errors";
import { MAX_PDF_BYTES, pdfTooLargeMessage } from "@/lib/uploads";
import {
  completeOpenRouterOAuth,
  readBrowserOpenRouterKey,
  validateBrowserOpenRouterKey,
  type KeySource,
} from "@/lib/openrouter-browser-key";

import { ManuscriptField } from "@/components/manuscript-field";
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
  type ApiKeyPayer,
  type CreatedTestEntry,
  type MaterialUploader,
  type QuestionSetOverview,
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

const DEFAULT_MODEL_ID = "openai/gpt-6-sol";
const FEATURED_MODEL_IDS = [
  "openai/gpt-6-astra",
  DEFAULT_MODEL_ID,
  "openai/gpt-6-luna",
] as const;
const FEATURED_MODELS: CatalogModel[] = [
  {
    id: "openai/gpt-6-astra",
    name: "GPT-6 Astra",
    inputModalities: ["text", "file"],
    recommended: true,
  },
  {
    id: DEFAULT_MODEL_ID,
    name: "GPT-6 Sol",
    inputModalities: ["text", "file"],
    recommended: true,
  },
  {
    id: "openai/gpt-6-luna",
    name: "GPT-6 Luna",
    inputModalities: ["text", "file"],
    recommended: true,
  },
];

function withFeaturedModels(catalog: CatalogModel[]) {
  const featuredIds = new Set(FEATURED_MODELS.map((model) => model.id));
  return [...FEATURED_MODELS, ...catalog.filter((model) => !featuredIds.has(model.id))];
}

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
      warmup: false,
      prompt: DEFAULT_MULTIPLE_CHOICE_PROMPT,
    };
  }
  return {
    id,
    type,
    name: "",
    count: 2,
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

export function ResearchCaptcha({
  username,
  initialGetStartedHidden = false,
}: {
  username: string;
  /** The account's saved choice to hide the Get started guide, read on the server. */
  initialGetStartedHidden?: boolean;
}) {
  const [getStartedHidden, setGetStartedHidden] = useState(initialGetStartedHidden);

  /**
   * Shows or hides the guide at once and saves the choice to the account, so it holds in every
   * browser and later session. A failed save leaves the page as chosen; it is a display preference,
   * and the next visit simply shows the last saved state.
   */
  function changeGetStartedHidden(hidden: boolean) {
    setGetStartedHidden(hidden);
    void fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ getStartedHidden: hidden }),
    }).catch(() => undefined);
  }

  const [mode, setMode] = useState<"default" | "custom" | "resume" | "mine">(
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
  /** Whole minutes in the form, seconds in the data. Empty means no overall limit. */
  const [overallLimitMinutes, setOverallLimitMinutes] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [working, setWorking] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationNotice, setGenerationNotice] = useState("");
  const [error, setError] = useState("");
  const [failedGenerationJobId, setFailedGenerationJobId] = useState("");
  // Which subtab of *New question set* was last open, so returning to the tab restores it.
  const [newSetView, setNewSetView] = useState<"default" | "custom">("default");
  // Question family cards on the Advanced subtab that are folded down to their header.
  const [collapsedBlocks, setCollapsedBlocks] = useState<ReadonlySet<string>>(() => new Set());
  const [sharingSetId, setSharingSetId] = useState("");
  const [copiedSetId, setCopiedSetId] = useState("");
  const [shareError, setShareError] = useState("");
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  /** Landing page for a question set that has not been served yet. */
  const [intro, setIntro] = useState<AttemptIntro | null>(null);
  const [outline, setOutline] = useState<AttemptOutline | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [setName, setSetName] = useState("");
  const [createdTests, setCreatedTests] = useState<CreatedTestEntry[]>([]);
  const [attemptList, setAttemptList] = useState<AttemptListEntry[]>([]);
  const [myAssessments, setMyAssessments] = useState<AttemptListEntry[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  /** Attempt whose link is mid-update, so only that row's button shows a pending state. */
  const [togglingLinkId, setTogglingLinkId] = useState("");
  const [resettingId, setResettingId] = useState("");
  const [expandedTestIds, setExpandedTestIds] = useState<Set<string>>(new Set());
  const [paperError, setPaperError] = useState("");
  // OpenRouter problems, shown under the key controls in the API Access panel rather than at the
  // bottom of the form.
  const [keyError, setKeyError] = useState("");
  // A newly saved or connected key answers the last complaint about the old one.
  useEffect(() => {
    const clear = () => setKeyError("");
    window.addEventListener("grecaptcha:openrouter-credential-changed", clear);
    return () => window.removeEventListener("grecaptcha:openrouter-credential-changed", clear);
  }, []);
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
  const [apiKeyPayer, setApiKeyPayer] = useState<ApiKeyPayer>("creator");
  const [materialUploader, setMaterialUploader] =
    useState<MaterialUploader>("creator");
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
      overallTimeLimitSeconds: overallLimitMinutes
        ? Number(overallLimitMinutes) * 60
        : null,
    }),
    [selectedModel, pdfEngine, blocks, randomize, overallLimitMinutes],
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
        if (active) reportError(caught, "Unable to connect the OpenRouter key.");
        return null;
      }),
      fetch("/api/openrouter/models")
        .then(async (response) => {
          const payload = (await response.json()) as {
            models?: CatalogModel[];
            error?: string;
          };
          if (!response.ok) throw new Error(payload.error ?? "Unable to load models.");
          return withFeaturedModels(payload.models ?? []);
        })
        .catch(() => FEATURED_MODELS),
    ])
      .then(([stored, connected, catalog]) => {
        if (!active) return;
        setModels(catalog);
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
        if (legacyDraft) {
          setTemplateStatus(
            "Updated the old starter configuration to the standard eight-question template.",
          );
        } else if (!stored.draft) {
          setTemplateStatus(
            "Starting from the standard default template. Edit any setting below.",
          );
        }
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
      const catalog = withFeaturedModels(payload.models as CatalogModel[]);
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
    const [createdResult, attemptsResult, mineResult] = await Promise.allSettled([
      fetch("/api/created-tests").then((response) => response.json()),
      fetch("/api/attempts").then((response) => response.json()),
      fetch("/api/attempts/mine").then((response) => response.json()),
    ]);
    if (createdResult.status === "fulfilled" && createdResult.value.tests) {
      setCreatedTests(createdResult.value.tests as CreatedTestEntry[]);
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

  const visibleCreatedTests = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return createdTests;
    return createdTests.filter((test) => {
      const parentMatches = [
        test.name,
        test.modelId,
        test.apiKeyPayer,
        test.materialUploader,
        test.id,
      ].some((field) => field.toLowerCase().includes(query));
      return (
        parentMatches ||
        test.attempts.some((entry) =>
          [
            entry.setLabel,
            entry.paperName,
            entry.status,
            entry.id,
            entry.takerUsername ?? "",
          ].some((field) => field.toLowerCase().includes(query)),
        )
      );
    });
  }, [catalogSearch, createdTests]);

  const visibleMyAssessments = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return myAssessments;
    return myAssessments.filter((entry) =>
      [entry.setLabel, entry.paperName, entry.status, entry.id].some((field) =>
        field.toLowerCase().includes(query),
      ),
    );
  }, [catalogSearch, myAssessments]);

  async function manageCreatedTestInvitation(test: CreatedTestEntry, revoke = false) {
    setSharingSetId(test.id);
    setShareError("");
    try {
      if (revoke) {
        const response = await fetch(
          `/api/templates/${encodeURIComponent(test.id)}/invite-share`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
          },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to revoke the invitation.");
        setTemplates((current) =>
          current.map((template) =>
            template.id === test.id ? { ...template, invitationShareToken: null } : template,
          ),
        );
        setTemplateStatus("Invitation revoked.");
        await refreshCatalog();
        return;
      }

      let participantPath = test.invitationPath;
      if (!participantPath) {
        const isTemplate =
          test.apiKeyPayer !== "creator" || test.materialUploader !== "creator";
        const endpoint =
          !isTemplate
            ? `/api/question-sets/${encodeURIComponent(test.id)}/share`
            : `/api/templates/${encodeURIComponent(test.id)}/invite-share`;
        const response = await fetch(endpoint, {
          method: "POST",
          ...(isTemplate
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: true }),
              }
            : {}),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to create the invitation.");
        participantPath = String(payload.participantPath ?? "");
        if (!participantPath) throw new Error("The invitation link was not returned.");
        if (isTemplate) {
          setTemplates((current) =>
            current.map((template) =>
              template.id === test.id
                ? {
                    ...template,
                    invitationShareToken: payload.invitationShareToken ?? null,
                  }
                : template,
            ),
          );
        }
        await refreshCatalog();
      }
      await navigator.clipboard.writeText(
        new URL(participantPath, window.location.origin).toString(),
      );
      setCopiedSetId(test.id);
      window.setTimeout(() => setCopiedSetId(""), 2_000);
    } catch (caught) {
      setShareError(caught instanceof Error ? caught.message : "Unable to manage the invitation.");
    } finally {
      setSharingSetId("");
    }
  }

  async function deleteCreatedTest(test: CreatedTestEntry) {
    const count = test.attempts.length;
    const consequence = count
      ? `This also permanently deletes ${count} ${
          count === 1 ? "attempt" : "attempts"
        }, including every answer, grade, timing, and feedback entry.`
      : "No attempts or response data are attached to it.";
    if (
      !window.confirm(
        `Delete the test “${test.name}”?\n\n${consequence}\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    setError("");
    try {
      const isTemplate =
        test.apiKeyPayer !== "creator" || test.materialUploader !== "creator";
      const endpoint =
        !isTemplate
          ? `/api/question-sets/${encodeURIComponent(test.id)}`
          : `/api/templates/${encodeURIComponent(test.id)}`;
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete the test.");
      if (isTemplate) {
        setTemplates((current) => current.filter((template) => template.id !== test.id));
        if (templateId === test.id) setTemplateId("");
      }
      setExpandedTestIds((current) => {
        const next = new Set(current);
        next.delete(test.id);
        return next;
      });
      await refreshCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the test.");
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
        body: JSON.stringify({
          name: templateName,
          config: currentConfig,
          apiKeyPayer,
          materialUploader,
        }),
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
        apiKeyPayer: ApiKeyPayer;
        materialUploader: MaterialUploader;
        config: StudyTemplateConfig;
      };
      setApiKeyPayer(template.apiKeyPayer);
      setMaterialUploader(template.materialUploader);
      if (template.apiKeyPayer === "taker" || template.materialUploader === "taker") {
        setSetName(template.name);
      }
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

  function changeWorkflow(
    nextPayer: ApiKeyPayer = apiKeyPayer,
    nextUploader: MaterialUploader = materialUploader,
  ) {
    if (nextPayer === apiKeyPayer && nextUploader === materialUploader) return;
    const selected = templates.find((template) => template.id === templateId);
    setApiKeyPayer(nextPayer);
    setMaterialUploader(nextUploader);
    if (
      selected &&
      (selected.apiKeyPayer !== nextPayer || selected.materialUploader !== nextUploader)
    ) {
      setTemplateId("");
      setTemplateStatus(`Cleared “${selected.name}” because it uses different workflow choices.`);
    }
  }

  async function updateInvitationSharing(id: string, enabled: boolean) {
    const response = await fetch(
      `/api/templates/${encodeURIComponent(id)}/invite-share`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      },
    );
    const payload = (await response.json()) as {
      error?: string;
      invitationShareToken?: string | null;
      participantPath?: string | null;
    };
    if (!response.ok) throw new Error(payload.error ?? "Unable to update sharing.");
    setTemplates((current) =>
      current.map((template) =>
        template.id === id
          ? { ...template, invitationShareToken: payload.invitationShareToken ?? null }
          : template,
      ),
    );
    if (payload.participantPath) {
      const link = `${window.location.origin}${payload.participantPath}`;
      await navigator.clipboard.writeText(link);
      setTemplateStatus("Invitation saved, published, and copied.");
    } else {
      setTemplateStatus("Invitation revoked.");
    }
  }

  async function setInvitationSharing(enabled: boolean) {
    if (!templateId) return;
    setError("");
    setTemplateStatus("");
    try {
      await updateInvitationSharing(templateId, enabled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update sharing.");
    }
  }

  async function createInvitationTemplate(
    event: FormEvent<HTMLFormElement>,
    config: StudyTemplateConfig,
  ) {
    event.preventDefault();
    if (!setName.trim()) return setError("Give the test set a name.");
    if (!config.modelId) return setError("Choose an OpenRouter model.");
    if (config.blocks.length === 0) return setError("Add at least one question family.");
    setWorking(true);
    setError("");
    setTemplateStatus("");
    const form = new FormData(event.currentTarget);
    const paper = form.get("paper");
    if (
      materialUploader === "creator" &&
      paper instanceof File &&
      paper.size > MAX_PDF_BYTES
    ) {
      setWorking(false);
      return setPaperError(pdfTooLargeMessage(paper.size));
    }
    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: setName,
          config,
          apiKeyPayer,
          materialUploader,
          templateId: mode === "custom" ? templateId || undefined : undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        template?: StudyTemplateSummary;
      };
      if (!response.ok || !payload.template) {
        throw new Error(payload.error ?? "Unable to save the invitation.");
      }
      const saved = payload.template;
      setTemplates((current) => [saved, ...current.filter((one) => one.id !== saved.id)]);
      setTemplateId(saved.id);
      setSetName(saved.name);
      if (materialUploader === "creator") {
        const materialResponse = await fetch(
          `/api/templates/${encodeURIComponent(saved.id)}/material`,
          { method: "POST", body: form },
        );
        const materialPayload = await materialResponse.json();
        if (!materialResponse.ok) {
          throw new Error(materialPayload.error ?? "Unable to save the source material.");
        }
      }
      await updateInvitationSharing(saved.id, true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to publish the invitation.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function deleteTemplate() {
    const target = templates.find((one) => one.id === templateId);
    if (!target) return;
    const createdTest = createdTests.find(
      (test) =>
        (test.apiKeyPayer !== "creator" || test.materialUploader !== "creator") &&
        test.id === target.id,
    );
    const consequence =
      (target.apiKeyPayer !== "creator" || target.materialUploader !== "creator") &&
      createdTest?.attempts.length
        ? ` This also permanently deletes its ${createdTest.attempts.length} ${
            createdTest.attempts.length === 1 ? "attempt" : "attempts"
          } and all associated manuscripts, answers, grades, timings, and feedback.`
        : "";
    if (
      !window.confirm(
        `Delete the template “${target.name}”?${consequence} This cannot be undone.`,
      )
    ) {
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
      await refreshCatalog();
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
        `Remove all ${blocks.length} question family ${plural}?\n\nTheir prompts, counts, limits and warm-up flags are lost, and the autosaved draft updates immediately. Reload a saved study set template to get a configuration back.\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    setBlocks([]);
  }

  // Every card folded: the shared control then offers to open them all again.
  const allBlocksCollapsed =
    blocks.length > 0 && blocks.every((block) => collapsedBlocks.has(block.id));

  function toggleAllBlocksCollapsed() {
    setCollapsedBlocks(
      allBlocksCollapsed ? new Set() : new Set(blocks.map((block) => block.id)),
    );
  }

  function toggleBlockCollapsed(id: string) {
    setCollapsedBlocks((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function updateBlock(id: string, patch: Partial<QuestionBlockConfig>) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === id ? ({ ...block, ...patch } as QuestionBlockConfig) : block,
      ),
    );
  }

  /**
   * Shows a failure where it belongs: OpenRouter problems in the API Access panel (on the course
   * workflow, the only one that has it on this page), everything else below the form.
   */
  function reportError(caught: unknown, fallback: string) {
    const message = caught instanceof Error ? caught.message : fallback;
    if (isOpenRouterError(caught) && apiKeyPayer === "creator") setKeyError(message);
    else setError(message);
  }

  async function generateSet(
    event: FormEvent<HTMLFormElement>,
    config: StudyTemplateConfig,
  ) {
    event.preventDefault();
    if (!config.modelId) return setError("No compatible OpenRouter model is available.");
    if (config.blocks.length === 0) return setError("Add at least one question family.");
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
    // A linked PDF is downloaded by the server before the job is queued, which can take a moment.
    setGenerationStatus(
      form.get("paperUrl") ? "Fetching the linked PDF…" : "Queued for generation…",
    );
    setGenerationNotice("");
    setError("");
    setKeyError("");
    form.set("modelId", config.modelId);
    form.set("pdfEngine", config.pdfEngine);
    form.set("blocks", JSON.stringify(config.blocks));
    form.set("randomize", String(config.randomize));
    form.set(
      "overallTimeLimitSeconds",
      config.overallTimeLimitSeconds === null
        ? ""
        : String(config.overallTimeLimitSeconds),
    );
    form.set("name", setName);
    form.set("apiKeyPayer", apiKeyPayer);
    form.set("materialUploader", materialUploader);
    if (mode === "custom" && templateId) form.set("sourceTemplateId", templateId);
    let jobId = "";
    try {
      const response = await fetch("/api/question-sets", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw errorFromPayload(payload, "Unable to generate questions.");
      jobId = String(payload.jobId ?? "");
      if (!jobId) throw new Error("The generation job was not created.");
      let generationCompleted = false;
      while (!generationCompleted) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const jobResponse = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        const jobPayload = await jobResponse.json();
        if (!jobResponse.ok) throw errorFromPayload(jobPayload, "Unable to check generation.");
        const job = jobPayload.job as {
          status: string;
          progressCurrent: number;
          progressTotal: number;
          error?: string;
          errorSource?: string;
          result?: { questionSetId?: string };
        };
        setGenerationStatus(
          job.status === "running"
            ? `Generating block ${Math.min(job.progressCurrent + 1, job.progressTotal)} of ${job.progressTotal}…`
            : "Waiting for a generation worker…",
        );
        if (job.status === "failed") throw errorFromPayload(job, "Question generation failed.");
        if (job.status === "completed") {
          if (!job.result?.questionSetId) {
            throw new Error("Generation completed without a question set.");
          }
          generationCompleted = true;
        }
      }
      await refreshCatalog();
      setFailedGenerationJobId("");
      setGenerationNotice(
        "Question set generated. Create and copy its reusable assessment link from Recent question sets.",
      );
    } catch (caught) {
      if (jobId) setFailedGenerationJobId(jobId);
      reportError(caught, "Question generation failed.");
    } finally {
      setWorking(false);
      setGenerationStatus("");
    }
  }

  async function retryGeneration() {
    if (!failedGenerationJobId) return;
    setWorking(true);
    setError("");
    setKeyError("");
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
      if (!response.ok) throw errorFromPayload(payload, "Unable to retry generation.");
      let generationCompleted = false;
      while (!generationCompleted) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const jobResponse = await fetch(
          `/api/jobs/${encodeURIComponent(failedGenerationJobId)}`,
        );
        const jobPayload = await jobResponse.json();
        if (!jobResponse.ok) throw errorFromPayload(jobPayload, "Unable to check generation.");
        const job = jobPayload.job as {
          status: string;
          error?: string;
          errorSource?: string;
          result?: { questionSetId?: string };
        };
        if (job.status === "failed") throw errorFromPayload(job, "Question generation failed.");
        if (job.status === "completed") {
          if (!job.result?.questionSetId) {
            throw new Error("Generation completed without a question set.");
          }
          generationCompleted = true;
        }
      }
      await refreshCatalog();
      setGenerationNotice("Question set generated. Its sharing link is available on the right.");
      setFailedGenerationJobId("");
    } catch (caught) {
      reportError(caught, "Unable to retry generation.");
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
      await showSummary(payload.attemptId as string);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load question set.");
    } finally {
      setWorking(false);
    }
  }

  if (result) {
    return (
      <ResultView
        result={result}
        submittedFeedback={
          outline?.attemptId === result.attemptId ? outline.examineeFeedback : null
        }
        onBack={exitToDashboard}
      />
    );
  }
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
          setCreatedTests((current) =>
            current.map((test) =>
              test.id === setOverview.id ? { ...test, name: name || setOverview.paperName } : test,
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
    <main className="app-shell dashboard-shell">
      <div className="brand">
        <span className="brand-mark">G</span>
        greCAPTCHA
        <span className="demo-badge">Public demo</span>
        <span className="account-name">Signed in as {username}</span>
        {/* The landing page, at an address that stays reachable while signed in. */}
        {getStartedHidden && (
          <button
            className="sign-out account-action"
            type="button"
            onClick={() => changeGetStartedHidden(false)}
          >
            Show guide
          </button>
        )}
        <Link className="sign-out account-action account-link" href="/about">
          About
        </Link>
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
      {!getStartedHidden && (
        <>
          <section className="card get-started" aria-labelledby="get-started-title">
            <div className="get-started-head">
              <h2 id="get-started-title">Get started</h2>
              <button
                className="collapse-button"
                type="button"
                title="Hide this guide. Show it again with “Show guide” at the top of the page."
                onClick={() => changeGetStartedHidden(true)}
              >
                Hide
              </button>
            </div>
            <ol className="get-started-steps">
              <li>
                <strong>Create.</strong> Generate an assessment in the{" "}
                <em>New question set</em> tab.
              </li>
              <li>
                <strong>Share.</strong> Copy the link on the right to share the exam with someone.
              </li>
              <li>
                <strong>Review.</strong> Open <em>Tests I&apos;ve Created</em> to see attempts
                completed on your exams.
              </li>
            </ol>
            <p className="get-started-taken">
              <strong>Taking an exam?</strong> The <em>Tests I&apos;ve Taken</em> tab shows assessments
              you have taken. Return there to continue an assessment, check whether it has been graded,
              or review your grades and feedback once they are available.
            </p>
          </section>
          <hr className="dashboard-divider" />
        </>
      )}

      <div className="dashboard-layout">
      <div className="dashboard-main">
      <div className="dashboard-navigation">
        <div className="mode-tabs" role="tablist" aria-label="Dashboard section">
          <button
            type="button"
            className={mode === "default" || mode === "custom" ? "active" : ""}
            onClick={() => setMode(newSetView)}
          >
            New question set
          </button>
          <button
            type="button"
            className={mode === "resume" ? "active" : ""}
            onClick={() => setMode("resume")}
          >
            Tests I&apos;ve Created
          </button>
          <button
            type="button"
            className={mode === "mine" ? "active" : ""}
            onClick={() => setMode("mine")}
          >
            Tests I&apos;ve Taken
          </button>
        </div>
      </div>
      {(mode === "default" || mode === "custom") && (
        <section className="dashboard-workflow" aria-labelledby="workflow-heading">
          <div>
            <span className="field-label" id="workflow-heading">Workflow choices</span>
          </div>
          <div>
            <span className="field-label">Who pays OpenRouter costs?</span>
            <div className="workflow-toggle" role="radiogroup" aria-label="OpenRouter payer">
              <button
                type="button"
                role="radio"
                aria-checked={apiKeyPayer === "creator"}
                className={apiKeyPayer === "creator" ? "active" : ""}
                onClick={() => changeWorkflow("creator", materialUploader)}
              >
                Test creator
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={apiKeyPayer === "taker"}
                className={apiKeyPayer === "taker" ? "active" : ""}
                onClick={() => changeWorkflow("taker", materialUploader)}
              >
                Test taker
              </button>
            </div>
            <span className="field-label">Who uploads source material?</span>
            <div className="workflow-toggle" role="radiogroup" aria-label="Material uploader">
              <button
                type="button"
                role="radio"
                aria-checked={materialUploader === "creator"}
                className={materialUploader === "creator" ? "active" : ""}
                onClick={() => changeWorkflow(apiKeyPayer, "creator")}
              >
                Test creator
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={materialUploader === "taker"}
                className={materialUploader === "taker" ? "active" : ""}
                onClick={() => changeWorkflow(apiKeyPayer, "taker")}
              >
                Test taker
              </button>
            </div>
          </div>
        </section>
      )}
      {(mode === "default" || mode === "custom") && (
        <div className="sub-tabs" role="tablist" aria-label="New question set">
          {(
            [
              ["default", "Default"],
              ["custom", "Advanced"],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={mode === view}
              className={mode === view ? "active" : ""}
              onClick={() => {
                setNewSetView(view);
                setMode(view);
              }}
            >
              {label}
            </button>
          ))}
        </div>
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
                {apiKeyPayer === "taker" || materialUploader === "taker"
                  ? "Load an existing invitation template or configure a new one below."
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
            {apiKeyPayer === "creator" && materialUploader === "creator" && (
              <div className="field">
                <label htmlFor="templateName">
                  Save current setup as
                  <FieldHint text="Test and template names must be unique within your account." />
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
              {apiKeyPayer === "creator" && materialUploader === "creator" && (
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
              {(apiKeyPayer === "taker" || materialUploader === "taker") && templateId && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() =>
                    void setInvitationSharing(
                      !templates.find((template) => template.id === templateId)
                        ?.invitationShareToken,
                    )
                  }
                >
                  {templates.find((template) => template.id === templateId)
                    ?.invitationShareToken
                    ? "Revoke invitation"
                    : "Publish and copy invitation"}
                </button>
              )}
            </div>
          </div>
          {templateStatus && <p className="template-status">{templateStatus}</p>}
        </section>
      )}

      {mode === "resume" || mode === "mine" ? (
        <section className="card form-card">
          <div className="field">
            <label htmlFor="catalogSearch">
              {mode === "mine" ? "Search tests I’ve taken" : "Search tests I’ve created"}
            </label>
            <input
              className="control"
              id="catalogSearch"
              value={catalogSearch}
              placeholder="Filter by set name, paper, username, or status"
              onChange={(event) => setCatalogSearch(event.target.value)}
            />
          </div>

          <div className="catalog-toolbar">
            <span className="hint">
              {mode === "mine"
                  ? `${myAssessments.length} ${myAssessments.length === 1 ? "assessment" : "assessments"}`
                  : `${createdTests.length} ${
                      createdTests.length === 1 ? "test" : "tests"
                    } · ${createdTests.reduce(
                      (total, test) => total + test.attempts.length,
                      0,
                    )} attempts`}
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

          {mode === "mine" ? (
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
              {shareError && (
                <p className="error" role="alert">
                  {shareError}
                </p>
              )}
              <div className="catalog-list">
                {visibleCreatedTests.length === 0 && (
                  <p className="hint catalog-empty">
                    {createdTests.length
                      ? "No test or attempt matches that search."
                      : "You have not created any tests yet."}
                  </p>
                )}
                {visibleCreatedTests.map((test) => {
                  const expanded = expandedTestIds.has(test.id);
                  return (
                    <article className="created-test" key={test.id}>
                      <div className="catalog-row created-test-parent">
                        <div className="catalog-main">
                          <div className="catalog-title-row">
                            <strong>{test.name}</strong>
                            <span className="pill">
                              {test.apiKeyPayer === "creator"
                                ? "Creator pays"
                                : "Taker pays"}
                            </span>
                            <span className="pill">
                              {test.materialUploader === "creator"
                                ? "Creator uploads"
                                : "Taker uploads"}
                            </span>
                          </div>
                          <span className="catalog-meta">
                            {test.questionCount}{" "}
                            {test.questionCount === 1 ? "question" : "questions"} ·{" "}
                            {test.attempts.length}{" "}
                            {test.attempts.length === 1 ? "attempt" : "attempts"} ·{" "}
                            {test.modelId || "No model selected"} · created{" "}
                            {new Date(test.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="catalog-actions">
                          <button
                            className="secondary"
                            type="button"
                            disabled={sharingSetId === test.id}
                            onClick={() => void manageCreatedTestInvitation(test)}
                          >
                            {sharingSetId === test.id
                              ? "Working…"
                              : copiedSetId === test.id
                                ? "Link copied"
                                : test.invitationEnabled
                                  ? "Copy invitation"
                                  : "Create invitation"}
                          </button>
                          {(test.apiKeyPayer !== "creator" ||
                            test.materialUploader !== "creator") &&
                            test.invitationEnabled && (
                            <button
                              className="secondary"
                              type="button"
                              disabled={sharingSetId === test.id}
                              onClick={() => void manageCreatedTestInvitation(test, true)}
                            >
                              Revoke invitation
                            </button>
                          )}
                          {test.apiKeyPayer === "creator" &&
                            test.materialUploader === "creator" && (
                            <button
                              className="secondary"
                              type="button"
                              disabled={working}
                              onClick={() => void showSetOverview(test.id)}
                            >
                              Overview
                            </button>
                          )}
                          <button
                            className="secondary"
                            type="button"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedTestIds((current) => {
                                const next = new Set(current);
                                if (next.has(test.id)) next.delete(test.id);
                                else next.add(test.id);
                                return next;
                              })
                            }
                          >
                            {expanded ? "Hide attempts" : "Show attempts"}
                          </button>
                          <button
                            className="secondary danger"
                            type="button"
                            onClick={() => void deleteCreatedTest(test)}
                          >
                            Delete test
                          </button>
                        </div>
                      </div>
                      {expanded && (
                        <div className="created-test-attempts">
                          {test.attempts.length === 0 ? (
                            <p className="hint catalog-empty">
                              No one has started this test yet. Copy the invitation to share it.
                            </p>
                          ) : (
                            test.attempts.map((entry) => (
                              <div className="catalog-row created-test-attempt" key={entry.id}>
                                <div className="catalog-main">
                                  <div className="catalog-title-row">
                                    <strong>
                                      {entry.takerUsername
                                        ? `Attempt by ${entry.takerUsername}`
                                        : "Creator attempt"}
                                    </strong>
                                    <span className="pill">
                                      {entry.status === "graded"
                                        ? `Graded${
                                            entry.score === null ? "" : ` · ${entry.score}%`
                                          }`
                                        : entry.status === "submitted"
                                          ? "Awaiting evaluation"
                                          : "In progress"}
                                    </span>
                                  </div>
                                  <span className="catalog-meta">
                                    {entry.paperName} · {entry.answeredCount} of{" "}
                                    {entry.totalQuestions} answered
                                    {entry.randomize && " · randomized"} ·{" "}
                                    {new Date(entry.createdAt).toLocaleString()}
                                  </span>
                                </div>
                                <div className="catalog-actions">
                                  <button
                                    className="secondary"
                                    type="button"
                                    disabled={working}
                                    onClick={() => void openAttempt(entry.id)}
                                  >
                                    {entry.status === "graded"
                                      ? "View report"
                                      : entry.status === "submitted"
                                        ? "Evaluate"
                                        : entry.answeredCount
                                          ? "Resume"
                                          : "Open"}
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
                                    className="secondary danger"
                                    type="button"
                                    onClick={() => void deleteAttemptRow(entry)}
                                  >
                                    Delete attempt
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      ) : (
        <form
          className="card form-card"
          onSubmit={(event) => {
            const config = mode === "default" ? defaultConfig : currentConfig;
            return apiKeyPayer === "creator" && materialUploader === "creator"
              ? generateSet(event, config)
              : createInvitationTemplate(event, config);
          }}
        >
          {apiKeyPayer === "creator" && <ProfessorOpenRouterPanel error={keyError} />}
          <div className="form-section">
            {mode !== "default" && materialUploader === "creator" && (
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
                      apiKeyPayer === "taker" || materialUploader === "taker"
                        ? "Names the reusable test shown to test takers who open its invitation link."
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
              {materialUploader === "creator" && (
                <>
                  <ManuscriptField id="paper" error={paperError} onError={setPaperError} />
                  <div className="field full">
                    <label htmlFor="contributions">
                      What material can we test on?
                    </label>
                    {/* No length constraint, blank included: with no statement the generator is told
                        there is no declared scope and covers the whole manuscript. */}
                    <textarea
                      className="control"
                      id="contributions"
                      name="contributions"
                      placeholder="Describe which sections or aspects of the source material the assessment should address."
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
                <FieldHint text="Once the budget is spent no further question is served and the attempt is graded. Counts the time questions were actually open, so pausing a session costs nothing. Leave blank for no limit." />
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
            </div>

            <div className="full">
              <div className="section-heading section-heading-stacked">
                <div>
                  <span className="field-label">Question families</span>
                  <p className="hint">Each card will make one generation request.</p>
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
                  <button
                    className="collapse-button collapse-all-button"
                    type="button"
                    disabled={blocks.length === 0}
                    aria-expanded={!allBlocksCollapsed}
                    aria-controls={blocks.map((block) => `${block.id}-body`).join(" ")}
                    onClick={toggleAllBlocksCollapsed}
                  >
                    <span className="collapse-chevron" aria-hidden="true" />
                    {allBlocksCollapsed ? "Expand all" : "Collapse all"}
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
                          <span className="question-number">Family {index + 1}</span>
                          <span className={`type-chip type-${block.type}`}>
                            {BLOCK_LABELS[block.type]}
                          </span>
                          {block.warmup && <span className="pill">Warm-up</span>}
                          {collapsedBlocks.has(block.id) && (
                            <span className="collapsed-summary">
                              {block.count} {block.count === 1 ? "question" : "questions"}
                            </span>
                          )}
                        </div>
                        <h3>{block.name.trim() || BLOCK_LABELS[block.type]}</h3>
                      </div>
                      <div className="question-config-actions">
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
                        <button
                          className="collapse-button"
                          type="button"
                          aria-expanded={!collapsedBlocks.has(block.id)}
                          aria-controls={`${block.id}-body`}
                          onClick={() => toggleBlockCollapsed(block.id)}
                        >
                          <span className="collapse-chevron" aria-hidden="true" />
                          {collapsedBlocks.has(block.id) ? "Expand" : "Collapse"}
                        </button>
                      </div>
                    </header>
                    {!collapsedBlocks.has(block.id) && (
                      <div className="config-grid" id={`${block.id}-body`}>
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
                    )}
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
            {apiKeyPayer === "creator" &&
              materialUploader === "creator" &&
              failedGenerationJobId && (
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
                ((apiKeyPayer === "taker" || materialUploader === "taker") &&
                  !setName.trim())
              }
            >
              {working
                ? apiKeyPayer === "taker" || materialUploader === "taker"
                  ? "Publishing invitation…"
                  : generationStatus || "Preparing upload…"
                : apiKeyPayer === "taker" || materialUploader === "taker"
                  ? "Create and copy invitation"
                  : "Generate question set"}
            </button>
          </div>
          {/* Beneath the button that produced it, so the result appears where the eye already is. */}
          {generationNotice && (
            <p className="template-status dashboard-notice submit-notice" role="status">
              {generationNotice}
            </p>
          )}
        </form>
      )}
      </div>
      <aside className="card recent-sets">
        <div className="recent-sets-heading">
          <div>
            <p className="eyebrow">Quick access</p>
            <h2>Recent question sets</h2>
          </div>
          <span className="pill">{Math.min(createdTests.length, 5)} of 5</span>
        </div>
        {createdTests.length === 0 ? (
          <p className="hint">Recently created tests appear here.</p>
        ) : (
          <div className="recent-set-list">
            {createdTests.slice(0, 5).map((test) => (
              <article className="recent-set" key={test.id}>
                <strong title={test.name}>{test.name}</strong>
                <span>
                  {test.questionCount} {test.questionCount === 1 ? "question" : "questions"} ·{" "}
                  {new Date(test.createdAt).toLocaleDateString()}
                </span>
                <button
                  className="secondary"
                  type="button"
                  disabled={sharingSetId === test.id}
                  onClick={() => void manageCreatedTestInvitation(test)}
                >
                  {sharingSetId === test.id
                    ? "Creating link…"
                    : copiedSetId === test.id
                      ? "Link copied"
                      : test.invitationEnabled
                        ? "Copy reusable link"
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
