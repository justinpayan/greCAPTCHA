import { normalizeUsername, USERNAME_PATTERN, USERNAME_RULE } from "@/lib/usernames";

export const MAX_ALLOWLIST_SIZE = 500;

export const ASSESSMENT_NOT_ALLOWED_MESSAGE =
  "This assessment is limited to a specific list of accounts. The username you're signed in as isn't on that list.";

export class AssessmentNotAllowedError extends Error {
  readonly notAllowed = true;
  readonly username: string;

  constructor(username: string) {
    super(ASSESSMENT_NOT_ALLOWED_MESSAGE);
    this.name = "AssessmentNotAllowedError";
    this.username = username;
  }
}

export function isAssessmentNotAllowedError(error: unknown): error is AssessmentNotAllowedError {
  return (
    error instanceof AssessmentNotAllowedError ||
    (error instanceof Error &&
      error.name === "AssessmentNotAllowedError" &&
      "username" in error)
  );
}

function linesFromRaw(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((entry) => String(entry));
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry));
    } catch {
      // Fall through and treat the value as a pasted list.
    }
  }
  return text.split(/[\n,]+/);
}

/**
 * Turns a textarea, JSON array, or string list into normalized unique usernames.
 * Empty input means the assessment is unrestricted.
 */
export function parseAllowlist(raw: unknown): string[] | null {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of linesFromRaw(raw)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (!USERNAME_PATTERN.test(trimmed)) {
      throw new Error(`“${trimmed}” is not a valid username. ${USERNAME_RULE}`);
    }
    const normalized = normalizeUsername(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(normalized);
    if (names.length > MAX_ALLOWLIST_SIZE) {
      throw new Error(`An allowlist may contain at most ${MAX_ALLOWLIST_SIZE} usernames.`);
    }
  }
  return names.length ? names : null;
}

export function readStoredAllowlist(json: string | null | undefined): string[] | null {
  if (!json) return null;
  try {
    return parseAllowlist(JSON.parse(json));
  } catch {
    return null;
  }
}

export function serializeAllowlist(list: string[] | null | undefined): string | null {
  return list?.length ? JSON.stringify(list) : null;
}

export function formatAllowlist(list: string[] | null | undefined): string {
  return list?.length ? list.join("\n") : "";
}

export function isUsernameAllowed(username: string, allowlist: string[] | null | undefined) {
  if (!allowlist?.length) return true;
  return allowlist.includes(normalizeUsername(username));
}
