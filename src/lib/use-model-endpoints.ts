"use client";

import { useEffect, useState } from "react";

/** A model endpoint the signed-in user may choose: its ID and display name, never its address. */
export type EndpointInfo = { id: string; label: string };

const OPENROUTER_ONLY: EndpointInfo[] = [{ id: "openrouter", label: "OpenRouter" }];

let pending: Promise<EndpointInfo[]> | null = null;

/** The user's endpoints, asked once per page load and shared by every caller. */
export function loadModelEndpoints(): Promise<EndpointInfo[]> {
  pending ??= fetch("/api/llm-endpoints", { cache: "no-store" })
    .then(async (response) => {
      const payload = (await response.json()) as { endpoints?: EndpointInfo[] };
      return payload.endpoints?.length ? payload.endpoints : OPENROUTER_ONLY;
    })
    .catch(() => {
      // Asked again next time rather than pinning a transient failure for the whole page.
      pending = null;
      return OPENROUTER_ONLY;
    });
  return pending;
}

/**
 * The endpoints the user may choose between, or null until the server has answered: OpenRouter,
 * plus their institution's when the operator assigned them to one.
 */
export function useModelEndpoints(): EndpointInfo[] | null {
  const [endpoints, setEndpoints] = useState<EndpointInfo[] | null>(null);
  useEffect(() => {
    let active = true;
    void loadModelEndpoints().then((list) => {
      if (active) setEndpoints(list);
    });
    return () => {
      active = false;
    };
  }, []);
  return endpoints;
}
