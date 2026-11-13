import "server-only";

import {
  assertBundleFits,
  bundleFromZip,
  type CodeBundle,
  CodeBundleTooLargeError,
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

/** Reads and checks the form's codebase fields without unpacking or downloading anything. */
export function readCodebaseSource(form: FormData): CodebaseSource {
  const repoUrl = String(form.get("repoUrl") ?? "").trim();
  const file = form.get("codebase");
  const hasFile = file instanceof File && file.size > 0;
  if (repoUrl && hasFile) throw new Error("Upload a ZIP or link to a repository, not both.");
  if (repoUrl) {
    const token = String(form.get("repoToken") ?? "").trim();
    return { kind: "link", link: parseRepoLink(repoUrl), ...(token ? { token } : {}) };
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
    const bundle =
      source.kind === "zip"
        ? bundleFromZip(new Uint8Array(await source.file.arrayBuffer()), source.file.name)
        : await (async () => {
            // The token is used here and goes no further: the bundle, the job, and the logs never
            // see it.
            const archive = await fetchRepoArchive(source.link, { token: source.token });
            return bundleFromZip(archive.bytes, archive.name, archive.source);
          })();
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
