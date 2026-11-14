import "server-only";

import { z } from "zod";

import {
  assertBundleFits,
  bundleFromZip,
  type CodeBundle,
  CodeBundleTooLargeError,
  codeScopeEntrySchema,
  comparePaths,
  describeCodeScope,
  lineCount,
  MAX_BUNDLE_FILES,
  serializeBundle,
} from "@/lib/code-bundle";
import { ManuscriptTooLargeError } from "@/lib/manuscript-input";
import { getOpenRouterModels } from "@/lib/openrouter";
import { fetchRepoArchive, parseRepoLink, type RepoLink } from "@/lib/repo-link";
import { MAX_ZIP_BYTES, zipTooLargeMessage } from "@/lib/uploads";

/**
 * Where a submitted codebase comes from: an uploaded ZIP (`codebase`), or a GitHub or GitLab link
 * (`repoUrl`) with an optional access token for a private repository (`repoToken`).
 */
export type CodebaseSource =
  | { kind: "zip"; file: File }
  | { kind: "link"; link: RepoLink; token?: string };

const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

/** Reads and checks the form's codebase fields without unpacking or downloading anything. */
export function readCodebaseSource(form: FormData): CodebaseSource {
  const repoUrl = String(form.get("repoUrl") ?? "").trim();
  const file = form.get("codebase");
  const hasFile = file instanceof File && file.size > 0;
  if (repoUrl && hasFile) throw new Error("Upload a ZIP or link to a repository, not both.");
  if (repoUrl) {
    const token = String(form.get("repoToken") ?? "").trim();
    let link = parseRepoLink(repoUrl);
    // Set when the submitter picked their files from a listing of the repository: the download is
    // pinned to the commit that listing came from, so a push in between cannot change the files.
    const commit = String(form.get("repoCommit") ?? "").trim();
    if (commit) {
      if (!COMMIT_SHA.test(commit)) throw new Error("The repository's commit could not be read. List its files again.");
      link = { ...link, ref: commit };
    }
    return { kind: "link", link, ...(token ? { token } : {}) };
  }
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a ZIP of the codebase, or link to its repository.");
  }
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Only ZIP archives are supported.");
  if (file.size > MAX_ZIP_BYTES) {
    throw new ManuscriptTooLargeError(zipTooLargeMessage(file.size));
  }
  return { kind: "zip", file };
}

/**
 * Unpacks the codebase into a bundle and checks it fits the model the set will be generated with.
 * The model's context comes from the public catalog; when the catalog cannot be reached only the
 * fixed ceiling is checked here, and the generation job checks the model again before it runs.
 */
export async function loadCodebase(
  source: CodebaseSource,
  modelId: string,
  options: { apiKey?: string; endpoint?: string } = {},
): Promise<CodeBundle> {
  // An institution's model list needs a key; without one only the fixed ceiling is checked here.
  const model = modelId
    ? ((await getOpenRouterModels(options.apiKey, options.endpoint).catch(() => [])).find(
        (entry) => entry.id === modelId,
      ) ?? null)
    : null;
  try {
    const bundle = await unpackCodebase(source);
    assertBundleFits(bundle, model);
    return bundle;
  } catch (error) {
    if (error instanceof CodeBundleTooLargeError) throw new ManuscriptTooLargeError(error.message);
    throw error;
  }
}

/** The bundle as the upload a generation job stores, named after the codebase. */
export function bundleUpload(bundle: CodeBundle): File {
  return new File([new Uint8Array(serializeBundle(bundle))], bundle.name, {
    type: "application/json",
  });
}

/** Unpacks or downloads the codebase without checking it against a model. */
export async function unpackCodebase(source: CodebaseSource): Promise<CodeBundle> {
  if (source.kind === "zip") {
    return bundleFromZip(new Uint8Array(await source.file.arrayBuffer()), source.file.name);
  }
  // The token is used here and goes no further: the bundle, the job, and the logs never see it.
  const archive = await fetchRepoArchive(source.link, { token: source.token });
  return bundleFromZip(archive.bytes, archive.name, archive.source);
}

/** What the file picker shows: the files that will be sent, and those left out that matter. */
export function codebaseListing(bundle: CodeBundle) {
  return {
    name: bundle.name,
    commitSha: bundle.source.kind === "repo" ? bundle.source.commitSha : null,
    files: bundle.files.map((file) => ({ path: file.path, lines: lineCount(file) })),
    skipped: bundle.skipped,
  };
}

/**
 * Applies the files the submitter picked (`codeScope`, JSON from the file picker) to the bundle,
 * and returns the contribution statement that describes them. Null when nothing was picked, which
 * leaves the whole codebase in scope and the written statement, if any, as it was.
 */
export function applyCodeScope(
  bundle: CodeBundle,
  form: FormData,
): { bundle: CodeBundle; contributions: string } | null {
  const raw = String(form.get("codeScope") ?? "").trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The files you picked could not be read. Pick them again.");
  }
  const entries = z.array(codeScopeEntrySchema).max(MAX_BUNDLE_FILES).parse(parsed);
  if (entries.length === 0) return null;
  const known = new Set(bundle.files.map((file) => file.path));
  const scope = new Map<string, string>();
  for (const entry of entries) {
    if (!known.has(entry.path)) {
      throw new Error(
        `“${entry.path}” is not among this codebase's files. Load the files again and pick the ones you wrote.`,
      );
    }
    scope.set(entry.path, entry.detail.trim());
  }
  const sorted = [...scope.entries()]
    .sort(([a], [b]) => comparePaths(a, b))
    .map(([path, detail]) => ({ path, detail }));
  return { bundle: { ...bundle, scope: sorted }, contributions: describeCodeScope(sorted) };
}
