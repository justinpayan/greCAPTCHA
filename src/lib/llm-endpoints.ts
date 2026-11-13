import "server-only";

import fs from "node:fs";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { OpenRouterError } from "@/lib/openrouter-errors";
import { normalizeUsername } from "@/lib/usernames";

/**
 * Where model requests go. OpenRouter for everyone, plus institution endpoints (a university's
 * LiteLLM gateway, say) that the operator assigns to named users in deployment config:
 *
 *   LLM_ENDPOINTS='{"cmu": {"label": "CMU", "baseUrl": "https://…", "users": ["instructor-a"]}}'
 *
 * or the same JSON in a file named by `LLM_ENDPOINTS_FILE`. Users never see or enter an address:
 * a user in a group may choose between OpenRouter and their group's endpoint, and each test
 * records which one it was made with (`"openrouter"` or the group's ID), so its grading goes back
 * to the same place. Membership lives only here, never in the database, so editing it affects
 * new tests only.
 */

export const OPENROUTER_ENDPOINT = "openrouter";
const OPENROUTER_URL = "https://openrouter.ai/api/v1";

/**
 * `litellm`: a LiteLLM proxy, whose keys report their budget and expiry and whose model list
 * carries prices. `openai`: any other OpenAI-compatible server (vLLM, say), which reports neither.
 */
export type EndpointKind = "openrouter" | "litellm" | "openai";

export type Endpoint = {
  id: string;
  kind: EndpointKind;
  label: string;
  baseUrl: string;
  /** A key used only to read the model list when no user key is at hand. */
  catalogKey: string | null;
};

/** What the browser is told: an endpoint's ID and display name, never its address. */
export type EndpointInfo = { id: string; label: string };

export class EndpointConfigError extends Error {}

const groupSchema = z.object({
  label: z.string().trim().min(1).max(40),
  baseUrl: z.string().trim().min(1),
  kind: z.enum(["litellm", "openai"]).default("litellm"),
  users: z.array(z.string()).default([]),
  catalogKey: z.string().trim().min(1).optional(),
});

/** The same rule test configurations use for the ID they store. */
export const ENDPOINT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

type Groups = { endpoints: Map<string, Endpoint>; groupByUser: Map<string, string> };

let cache: { source: string; groups: Groups } | null = null;

function configSource(): { text: string; origin: string } | null {
  const inline = process.env.LLM_ENDPOINTS?.trim();
  const file = process.env.LLM_ENDPOINTS_FILE?.trim();
  if (inline && file) {
    throw new EndpointConfigError("Set LLM_ENDPOINTS or LLM_ENDPOINTS_FILE, not both.");
  }
  if (file) {
    try {
      return { text: fs.readFileSync(file, "utf8"), origin: file };
    } catch {
      throw new EndpointConfigError(`LLM_ENDPOINTS_FILE could not be read: ${file}`);
    }
  }
  return inline ? { text: inline, origin: "LLM_ENDPOINTS" } : null;
}

function parseGroups(text: string, origin: string): Groups {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EndpointConfigError(`${origin} is not valid JSON.`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new EndpointConfigError(`${origin} must be an object of groups, keyed by group ID.`);
  }
  const endpoints = new Map<string, Endpoint>();
  const groupByUser = new Map<string, string>();
  for (const [id, value] of Object.entries(raw)) {
    if (id === OPENROUTER_ENDPOINT || !ENDPOINT_ID_PATTERN.test(id)) {
      throw new EndpointConfigError(
        `Group ID “${id}” in ${origin} must be lowercase letters, digits, and hyphens, and not “openrouter”.`,
      );
    }
    const parsed = groupSchema.safeParse(value);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join(".");
      throw new EndpointConfigError(
        field
          ? `Group “${id}” in ${origin} has a missing or invalid “${field}” (label: 1–40 characters; kind: "litellm" or "openai"; users: a list of usernames).`
          : `Group “${id}” in ${origin} must be an object.`,
      );
    }
    const group = parsed.data;
    let url: URL;
    try {
      url = new URL(group.baseUrl);
    } catch {
      throw new EndpointConfigError(`Group “${id}” in ${origin} has a baseUrl that is not a URL.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new EndpointConfigError(`Group “${id}” in ${origin} must use an http or https baseUrl.`);
    }
    if (url.username || url.password) {
      throw new EndpointConfigError(
        `Group “${id}” in ${origin} has credentials in its baseUrl; use catalogKey for a key.`,
      );
    }
    endpoints.set(id, {
      id,
      kind: group.kind,
      label: group.label,
      baseUrl: url.toString().replace(/\/+$/, ""),
      catalogKey: group.catalogKey ?? null,
    });
    for (const username of group.users) {
      const key = normalizeUsername(username);
      if (!key) continue;
      const existing = groupByUser.get(key);
      if (existing && existing !== id) {
        throw new EndpointConfigError(
          `User “${username}” is in both “${existing}” and “${id}” in ${origin}; a user may be in one group.`,
        );
      }
      groupByUser.set(key, id);
    }
  }
  return { endpoints, groupByUser };
}

/**
 * The configured groups, parsed once per distinct configuration. Throws `EndpointConfigError` on a
 * malformed one; the server checks this at startup, so a mistake stops the deploy instead of
 * sending someone's tests to the wrong place.
 */
export function endpointGroups(): Groups {
  const source = configSource();
  const key = source ? `${source.origin}\n${source.text}` : "";
  if (cache?.source !== key) {
    cache = {
      source: key,
      groups: source ? parseGroups(source.text, source.origin) : { endpoints: new Map(), groupByUser: new Map() },
    };
  }
  return cache.groups;
}

/**
 * The endpoint a test records. An ID no longer in the config (a group the operator removed) is
 * reported beside the key controls rather than failing somewhere obscure.
 */
export function endpointById(id: string | null | undefined): Endpoint {
  if (!id || id === OPENROUTER_ENDPOINT) {
    return { id: OPENROUTER_ENDPOINT, kind: "openrouter", label: "OpenRouter", baseUrl: OPENROUTER_URL, catalogKey: null };
  }
  const endpoint = endpointGroups().endpoints.get(id);
  if (!endpoint) throw new OpenRouterError("This test's model endpoint is no longer configured on this server.");
  return endpoint;
}

/** The group a username belongs to, or null. Matched the way logins are, ignoring case. */
export function groupForUsername(username: string): Endpoint | null {
  const groups = endpointGroups();
  const id = groups.groupByUser.get(normalizeUsername(username));
  return id ? (groups.endpoints.get(id) ?? null) : null;
}

/** What a user may choose between: OpenRouter, then their group's endpoint if they are in one. */
export function endpointsForUsername(username: string): EndpointInfo[] {
  const group = groupForUsername(username);
  const openRouter = { id: OPENROUTER_ENDPOINT, label: "OpenRouter" };
  return group ? [openRouter, { id: group.id, label: group.label }] : [openRouter];
}

/** Refuses an endpoint the user is not assigned to. OpenRouter is open to everyone. */
export function assertEndpointAllowed(username: string, endpoint: string): void {
  if (endpoint === OPENROUTER_ENDPOINT) return;
  if (groupForUsername(username)?.id !== endpoint) {
    throw new OpenRouterError("Your account is not set up to use that model endpoint.");
  }
}

/** The same check for an account known only by ID, such as a template's owner. */
export function assertEndpointAllowedForUserId(userId: string, endpoint: string): void {
  if (endpoint === OPENROUTER_ENDPOINT) return;
  const owner = db.select({ username: users.username }).from(users).where(eq(users.id, userId)).get();
  if (!owner || groupForUsername(owner.username)?.id !== endpoint) {
    throw new OpenRouterError(
      "The test creator's account is no longer set up to use this test's model endpoint.",
    );
  }
}
