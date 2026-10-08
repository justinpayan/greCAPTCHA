"use client";

import { Brand } from "@/components/brand";
import type { InvitationTemplateOverview } from "@/lib/quiz";

const TYPE_LABELS = {
  fill_blank: "Fill in the blank",
  multiple_choice: "Multiple choice",
  free_response: "Free response",
} as const;

function formatLimit(seconds: number | null) {
  if (seconds === null) return "No overall limit";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes} minutes`;
}

export function TemplateOverview({
  overview,
  onBack,
}: {
  overview: InvitationTemplateOverview;
  onBack: () => void;
}) {
  const questionCount = overview.config.blocks.reduce((total, block) => total + block.count, 0);

  return (
    <main className="app-shell dashboard-shell">
      <Brand onHome={onBack} />

      <header className="quiz-header sequential-header">
        <div>
          <p className="eyebrow">Invitation test</p>
          <h1>{overview.name}</h1>
          <div className="quiz-meta">
            {overview.config.modelId} ·{" "}
            {overview.config.pdfEngine === "native"
              ? "native parsing"
              : overview.config.pdfEngine}
          </div>
        </div>
        <div className="summary-header-side">
          <div className="sequence-status">
            <div className="sequence-progress">
              {questionCount} {questionCount === 1 ? "question" : "questions"}
            </div>
            <div className="question-timer">{formatLimit(overview.config.overallTimeLimitSeconds)}</div>
          </div>
        </div>
      </header>

      <section className="card report-card">
        <div className="report-card-section">
          <p className="eyebrow">Workflow</p>
          <p>
            <strong>
              {overview.apiKeyPayer === "creator" ? "Test creator" : "Test taker"}
            </strong>{" "}
            pays for API use.{" "}
            <strong>
              {overview.materialUploader === "creator" ? "Test creator" : "Test taker"}
            </strong>{" "}
            uploads the manuscript.
          </p>
        </div>
        <div className="report-card-section">
          <p className="eyebrow">Material and access</p>
          <p>
            {overview.materialFileName
              ? `Manuscript: ${overview.materialFileName}`
              : "The test taker supplies the manuscript."}
          </p>
          <p>
            {overview.takerAllowlist?.length
              ? `Restricted to ${overview.takerAllowlist.length} allowed username${
                  overview.takerAllowlist.length === 1 ? "" : "s"
                }.`
              : "Anyone with the invitation can take this test."}
          </p>
          {overview.materialContributions && <p>{overview.materialContributions}</p>}
        </div>
      </section>

      <section className="summary-list">
        {overview.config.blocks.map((block, index) => (
          <article className={`card summary-item type-${block.type}`} key={block.id}>
            <div className="summary-item-head">
              <span className="summary-position">{index + 1}</span>
              <span className={`type-chip type-${block.type}`}>{TYPE_LABELS[block.type]}</span>
              {block.name && <span className="summary-block">{block.name}</span>}
              {block.warmup && <span className="pill">Warm-up</span>}
              <span className="summary-state">
                {block.count} {block.count === 1 ? "question" : "questions"}
              </span>
            </div>
            <p className="summary-description">{block.prompt}</p>
          </article>
        ))}
      </section>

      <div className="quiz-actions sequential-actions">
        <button className="secondary" type="button" onClick={onBack}>
          Back to dashboard
        </button>
      </div>
    </main>
  );
}
