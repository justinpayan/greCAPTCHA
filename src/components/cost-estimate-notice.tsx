"use client";

import { useEffect, useState } from "react";

import type { CostEstimate, CostRange } from "@/lib/cost-estimate";

/**
 * The grading estimate for an attempt, fetched once while `enabled` (while the page is asking the
 * taker for a key). Null until it arrives, and if it cannot be loaded, in which case the page
 * simply shows no estimate.
 */
export function useGradingCostEstimate(attemptId: string, enabled: boolean) {
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetch(`/api/attempts/${encodeURIComponent(attemptId)}/cost-estimate`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { estimate?: CostEstimate } | null) => {
        if (active && payload?.estimate) setEstimate(payload.estimate);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [attemptId, enabled]);
  return estimate;
}

/** "$0.12–$0.45"; "up to $0.03" when the low end rounds to nothing; "under $0.01" when both do. */
function formatRange(range: CostRange) {
  const dollars = (value: number) => `$${value.toFixed(2)}`;
  if (range.high < 0.005) return "under $0.01";
  if (range.low < 0.005) return `up to ${dollars(range.high)}`;
  if (dollars(range.low) === dollars(range.high)) return `about ${dollars(range.high)}`;
  return `${dollars(range.low)}–${dollars(range.high)}`;
}

/**
 * Tells a test taker who pays with their own OpenRouter key which model their key will be used
 * with and roughly what it will cost, before they hand the key over.
 */
export function CostEstimateNotice({
  estimate,
  includeGeneration,
}: {
  estimate: CostEstimate;
  /** The invitation page covers generating the test as well as grading it later. */
  includeGeneration: boolean;
}) {
  const known = includeGeneration
    ? estimate.generation !== null && estimate.grading !== null
    : estimate.grading !== null;
  return (
    <section className="cost-estimate" aria-label="Model and estimated cost">
      <p className="cost-estimate-model">
        Your key will be used with <strong>{estimate.modelName}</strong>
        {estimate.modelName !== estimate.modelId && (
          <span className="cost-estimate-id"> ({estimate.modelId})</span>
        )}
        , chosen by the test creator.
      </p>
      {known ? (
        <>
          <dl className="cost-estimate-lines">
            {includeGeneration && estimate.generation && (
              <div>
                <dt>Generating your assessment</dt>
                <dd>{formatRange(estimate.generation)}</dd>
              </div>
            )}
            {estimate.grading && (
              <div>
                <dt>{includeGeneration ? "Grading it when you finish" : "Grading your answers"}</dt>
                <dd>
                  {estimate.grading.high === 0
                    ? "no charge (nothing needs model grading)"
                    : formatRange(estimate.grading)}
                </dd>
              </div>
            )}
          </dl>
          <p className="cost-estimate-note">
            Estimated from OpenRouter&apos;s published prices for this model
            {includeGeneration &&
              (estimate.pagesKnown
                ? ` and the ${estimate.pages}-page source material`
                : `, assuming a ${estimate.pages}-page paper; longer papers cost proportionally more`)}
            . The actual charge depends on answer length and how much the model reasons, and is
            billed to your OpenRouter account.
          </p>
        </>
      ) : (
        <p className="cost-estimate-note">
          A cost estimate is not available for this model right now. Check its prices on
          OpenRouter before continuing.
        </p>
      )}
    </section>
  );
}
