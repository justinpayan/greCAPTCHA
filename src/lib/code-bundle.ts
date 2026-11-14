import "server-only";

import { unzipSync } from "fflate";
import { z } from "zod";

/**
 * A code submission turned into what the model, the grader, and the participant's code viewer
 * all read: the repository's source files as text, with everything that is not source left out.
 *
 * Models cannot read a ZIP (OpenRouter's chat endpoint takes text, images, and PDFs), so the
 * archive is unpacked here, in memory, and never written to disk: nothing in it can escape a
 * directory or plant a symlink, because there is no directory. What is kept is filtered for
 * relevance (no dependencies, build output, lockfiles, binaries) and for secrets (no `.env` files,
 * private keys, or recognisable access tokens), since this text is sent to a third-party model.
 *
 * The bundle is stored, encrypted, in place of the archive, so generation, grading, and the viewer
 * cannot disagree about which files the questions were based on.
 */

/** Uncompressed bytes of source kept from one archive. */
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
/** Source files kept from one archive. */
export const MAX_BUNDLE_FILES = 2_000;
/** Archive entries examined at all, so an archive of a million empty files is refused cheaply. */
export const MAX_ARCHIVE_ENTRIES = 50_000;
/** A single file larger than this is data or generated output, not something a student wrote. */
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;
/** The most source tokens any assessment is generated from, whatever the model's context. */
export const MAX_BUNDLE_TOKENS = 300_000;
/**
 * Context kept free for everything that is not the code: instructions, the questions made so far,
 * and the model's output, which for a large candidate pool from a reasoning model is substantial.
 */
export const CONTEXT_HEADROOM_TOKENS = 30_000;

export const codeFileSchema = z.object({
  path: z.string().min(1).max(1_000),
  text: z.string(),
});
export type CodeFile = z.infer<typeof codeFileSchema>;

export const skippedFileSchema = z.object({
  path: z.string(),
  reason: z.enum(["secret", "binary", "too-large", "excluded"]),
});
export type SkippedFile = z.infer<typeof skippedFileSchema>;

/** The most characters a submitter may write about one included file. */
export const MAX_SCOPE_DETAIL_CHARS = 2_000;

export const codeScopeEntrySchema = z.object({
  path: z.string().min(1).max(1_000),
  /** Which functions, classes, or parts of the file are theirs; blank means the whole file. */
  detail: z.string().max(MAX_SCOPE_DETAIL_CHARS).default(""),
});
export type CodeScopeEntry = z.infer<typeof codeScopeEntrySchema>;

export const codeBundleSchema = z.object({
  version: z.literal(1),
  /** What to call the submission: the archive's or repository's name. */
  name: z.string().min(1).max(300),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("zip") }),
    z.object({
      kind: z.literal("repo"),
      host: z.string(),
      repo: z.string(),
      ref: z.string(),
      commitSha: z.string().nullable(),
    }),
  ]),
  files: z.array(codeFileSchema).min(1),
  /** Left out for a reason the submitter should know about: secrets and oversized files. */
  skipped: z.array(skippedFileSchema),
  /** How many matches of known token formats were replaced in kept files. */
  redactions: z.number().int().min(0),
  /**
   * The files the submitter declared as theirs, each optionally narrowed to the functions or
   * classes they wrote. Questions are generated only about these; every other file is context.
   * Absent or empty means the whole codebase is in scope.
   */
  scope: z.array(codeScopeEntrySchema).optional(),
});
export type CodeBundle = z.infer<typeof codeBundleSchema>;

/** A refusal whose message is meant for the person who submitted the code. */
export class CodeBundleError extends Error {}

/** The bundle is bigger than the assessment can be generated from; answered as 413. */
export class CodeBundleTooLargeError extends CodeBundleError {}

/** Directories that hold dependencies, build output, caches, or tooling state, never authored code. */
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "jspm_packages",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  ".eggs",
  ".gradle",
  ".idea",
  ".vs",
  "obj",
  "Pods",
  "DerivedData",
  ".terraform",
  "__MACOSX",
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "packages.lock.json",
  "flake.lock",
  ".DS_Store",
  "Thumbs.db",
]);

const EXCLUDED_SUFFIXES = [".min.js", ".min.css", ".map", ".egg-info"];

/** Extensions that are never source text; content sniffing catches the rest. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "tif", "tiff", "psd", "heic", "avif",
  "mp3", "mp4", "wav", "ogg", "flac", "m4a", "mov", "avi", "mkv", "webm",
  "ttf", "otf", "woff", "woff2", "eot",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war", "ear", "whl",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "exe", "dll", "so", "dylib", "o", "a", "lib", "obj", "class", "pyc", "pyo", "wasm", "bin",
  "dat", "db", "sqlite", "sqlite3", "pkl", "pickle", "npy", "npz", "h5", "hdf5", "parquet",
  "pt", "pth", "onnx", "ckpt", "safetensors", "tflite",
]);

/** Files that hold credentials by convention. Templates of them carry no secrets and stay in. */
function isSecretFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env" || (lower.startsWith(".env.") && !/\.(example|sample|template|dist)$/.test(lower))) {
    return true;
  }
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(lower)) return true;
  if (/\.(pem|key|p12|pfx|keystore|jks|ppk|asc|gpg|kdbx)$/.test(lower)) return true;
  if ([".npmrc", ".pypirc", ".netrc", ".git-credentials", ".htpasswd"].includes(lower)) return true;
  if (/^(credentials|client_secrets?|service[-_]?account.*)\.json$/.test(lower)) return true;
  return false;
}

const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * Token formats specific enough to replace without breaking ordinary code. A file holding a key
 * inline keeps its code, so it can still be asked about; only the key itself is withheld.
 */
const TOKEN_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ID
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab personal access token
  /\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{32,}\b/g, // OpenAI, Anthropic, OpenRouter
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bsk_live_[0-9A-Za-z]{24,}\b/g, // Stripe
  /\bhf_[A-Za-z0-9]{34,}\b/g, // Hugging Face
];

export function redactTokens(text: string): { text: string; count: number } {
  let count = 0;
  let result = text;
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, () => {
      count += 1;
      return "[REDACTED]";
    });
  }
  return { text: result, count };
}

/**
 * A ZIP entry's name as a clean relative path, or null for one that should not exist: absolute
 * paths, `..` segments, and empty names. Nothing is written to disk, so this is about honest
 * display rather than traversal, but a path the viewer shows must be one the repository has.
 */
export function normalizeEntryPath(name: string): string | null {
  const segments = name.replace(/\\/g, "/").split("/");
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    kept.push(segment);
  }
  if (kept.length === 0 || /^[a-zA-Z]:$/.test(kept[0])) return null;
  return kept.join("/");
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Why a path is left out without reading it, or null to read it. */
function exclusionByPath(path: string): SkippedFile["reason"] | null {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  if (segments.slice(0, -1).some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return "excluded";
  if (EXCLUDED_FILES.has(name)) return "excluded";
  if (EXCLUDED_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) return "excluded";
  if (isSecretFileName(name)) return "secret";
  if (BINARY_EXTENSIONS.has(extension(path))) return "binary";
  return null;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The file as text, or null when it is not UTF-8 text (a NUL byte or invalid encoding). */
function decodeText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, 8_000).includes(0)) return null;
  try {
    return utf8.decode(bytes).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/**
 * A Jupyter notebook as its cells' source, without outputs, which are mostly base64 images and
 * would cost more tokens than the code. Null when the file is not a readable notebook.
 */
export function notebookSource(text: string): string | null {
  try {
    const notebook = JSON.parse(text) as {
      cells?: Array<{ cell_type?: string; source?: string | string[] }>;
    };
    if (!Array.isArray(notebook.cells)) return null;
    return notebook.cells
      .map((cell, index) => {
        const source = Array.isArray(cell.source) ? cell.source.join("") : (cell.source ?? "");
        return `# %% [${cell.cell_type ?? "code"}] cell ${index + 1}\n${source.trimEnd()}`;
      })
      .join("\n\n");
  } catch {
    return null;
  }
}

/** GitHub and GitLab archives wrap everything in one `repo-ref/` folder that is not in the repo. */
function stripCommonRoot(paths: string[]): (path: string) => string {
  if (paths.length === 0) return (path) => path;
  const first = paths[0].split("/")[0];
  const shared = paths.every((path) => path.includes("/") && path.split("/")[0] === first);
  return shared ? (path) => path.slice(first.length + 1) : (path) => path;
}

/**
 * Unpacks a ZIP archive into a bundle. Throws `CodeBundleError` with a message for the submitter
 * when the archive is not a ZIP, holds no source, or exceeds the file or byte limits.
 */
export function bundleFromZip(
  bytes: Uint8Array,
  name: string,
  source: CodeBundle["source"] = { kind: "zip" },
): CodeBundle {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new CodeBundleError("The selected file is not a valid ZIP archive.");
  }

  const skipped: SkippedFile[] = [];
  let entries = 0;
  let declaredBytes = 0;
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      // Decides from the central directory, before anything is inflated, so excluded folders and
      // oversized files cost nothing to skip. fflate inflates into a buffer of the declared size,
      // so an entry that lies about its size cannot grow past it.
      filter(entry) {
        entries += 1;
        if (entries > MAX_ARCHIVE_ENTRIES) {
          throw new CodeBundleError(
            `This archive holds more than ${MAX_ARCHIVE_ENTRIES.toLocaleString("en-US")} entries. Remove dependency and build folders before zipping it.`,
          );
        }
        if (entry.name.endsWith("/")) return false;
        const path = normalizeEntryPath(entry.name);
        if (!path) return false;
        const reason = exclusionByPath(path);
        if (reason) {
          // Excluded folders can hold thousands of files; only reasons worth reporting are kept.
          if (reason === "secret") skipped.push({ path, reason });
          return false;
        }
        if (entry.originalSize > MAX_SOURCE_FILE_BYTES) {
          skipped.push({ path, reason: "too-large" });
          return false;
        }
        declaredBytes += entry.originalSize;
        if (declaredBytes > MAX_BUNDLE_BYTES) {
          throw new CodeBundleTooLargeError(
            `This archive holds more than ${MAX_BUNDLE_BYTES / 1024 / 1024} MiB of source after leaving out dependencies, build output, and binary files. Upload only the code you wrote.`,
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof CodeBundleError) throw error;
    throw new CodeBundleError("The archive could not be read. Re-create the ZIP and try again.");
  }

  const files: CodeFile[] = [];
  let redactions = 0;
  for (const [entryName, content] of Object.entries(unpacked)) {
    const path = normalizeEntryPath(entryName)!;
    let text = decodeText(content);
    if (text === null) {
      skipped.push({ path, reason: "binary" });
      continue;
    }
    if (extension(path) === "ipynb") {
      text = notebookSource(text);
      if (text === null) {
        skipped.push({ path, reason: "binary" });
        continue;
      }
    }
    if (PRIVATE_KEY_BLOCK.test(text)) {
      skipped.push({ path, reason: "secret" });
      continue;
    }
    if (!text.trim()) continue;
    const redacted = redactTokens(text);
    redactions += redacted.count;
    files.push({ path, text: redacted.text });
  }

  const strip = stripCommonRoot([...files.map((file) => file.path), ...skipped.map((file) => file.path)]);
  for (const file of files) file.path = strip(file.path);
  for (const file of skipped) file.path = strip(file.path);
  files.sort((a, b) => comparePaths(a.path, b.path));
  skipped.sort((a, b) => comparePaths(a.path, b.path));

  if (files.length === 0) {
    throw new CodeBundleError(
      "No source files were found in this archive after leaving out dependencies, build output, binary files, and secrets.",
    );
  }
  if (files.length > MAX_BUNDLE_FILES) {
    throw new CodeBundleTooLargeError(
      `This archive holds ${files.length.toLocaleString("en-US")} source files; at most ${MAX_BUNDLE_FILES.toLocaleString("en-US")} are allowed. Upload only the code you wrote.`,
    );
  }

  return {
    version: 1,
    name: name.replace(/\.zip$/i, "").slice(0, 300) || "codebase",
    source,
    files,
    skipped,
    redactions,
  };
}

/** Orders paths as a file tree does: by directory, then name, case-insensitively. */
export function comparePaths(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

/**
 * The bundle as the model reads it: each file under its path, every line numbered, so a question
 * can name the lines it draws on and the viewer can open them.
 */
export function renderBundleForModel(bundle: CodeBundle): string {
  return bundle.files
    .map((file) => {
      const lines = file.text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
      const width = String(lines.length).length;
      const numbered = lines
        .map((line, index) => `${String(index + 1).padStart(width, " ")}| ${line}`)
        .join("\n");
      return `<file path="${file.path}" lines="${lines.length}">\n${numbered}\n</file>`;
    })
    .join("\n\n");
}

/** How many lines a file has, counted the way the model's numbering counts them. */
export function lineCount(file: CodeFile): number {
  return file.text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length;
}

/**
 * Tokens the rendered bundle costs, estimated without a tokenizer. Source code runs at roughly
 * three to four characters a token across current tokenizers; three is used so the estimate errs
 * towards refusing a bundle that would not fit rather than sending one that fails mid-generation.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function bundleTokens(bundle: CodeBundle): number {
  return estimateTokens(renderBundleForModel(bundle));
}

/** The most source tokens allowed for a model with this context window (or none known). */
export function bundleTokenLimit(contextLength?: number): number {
  if (!contextLength || !Number.isFinite(contextLength)) return MAX_BUNDLE_TOKENS;
  return Math.max(0, Math.min(MAX_BUNDLE_TOKENS, contextLength - CONTEXT_HEADROOM_TOKENS));
}

/**
 * Refuses a bundle that does not fit, naming its size, the limit, and where the bulk is, so the
 * submitter knows what to remove. Nothing is ever truncated: questions generated from part of a
 * codebase the submitter believes was sent whole would be unfair to them.
 */
export function assertBundleFits(
  bundle: CodeBundle,
  model: { name: string; contextLength?: number } | null,
): void {
  const tokens = bundleTokens(bundle);
  const limit = bundleTokenLimit(model?.contextLength);
  if (tokens <= limit) return;

  const fileTokens = bundle.files.map((file) => ({
    path: file.path,
    tokens: estimateTokens(file.text) + lineCount(file) * 2,
  }));
  const folders = new Map<string, number>();
  for (const file of fileTokens) {
    const folder = file.path.includes("/") ? `${file.path.split("/")[0]}/` : "(top level)";
    folders.set(folder, (folders.get(folder) ?? 0) + file.tokens);
  }
  const format = (value: number) => `${Math.round(value / 1000).toLocaleString("en-US")}k`;
  const largestFiles = fileTokens
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
    .map((file) => `${file.path} (${format(file.tokens)})`);
  const largestFolders = [...folders.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([folder, value]) => `${folder} (${format(value)})`);
  const why =
    model?.contextLength && limit < MAX_BUNDLE_TOKENS
      ? `the most ${model.name} can work from`
      : "the most an assessment can be generated from";

  throw new CodeBundleTooLargeError(
    `This codebase is about ${format(tokens)} tokens after filtering, and ${format(limit)} is ${why}. ` +
      `Largest folders: ${largestFolders.join(", ")}. Largest files: ${largestFiles.join(", ")}. ` +
      `Remove data, generated, or third-party files, or submit only the code you wrote, and try again.`,
  );
}

/**
 * The declared scope as the contribution statement stored with the test: one file per line, with
 * the functions the submitter named, so reports, exports, and the grader read it as written.
 */
export function describeCodeScope(scope: CodeScopeEntry[]): string {
  return scope
    .map((entry) => {
      const detail = entry.detail.trim().replace(/\s*\n\s*/g, "; ");
      return detail ? `${entry.path}: ${detail}` : `${entry.path} (whole file)`;
    })
    .join("\n");
}

export function serializeBundle(bundle: CodeBundle): Buffer {
  return Buffer.from(JSON.stringify(bundle), "utf8");
}

export function parseBundle(bytes: Uint8Array): CodeBundle {
  return codeBundleSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
}

/** A location the model reported, kept only when it names a real file, with lines clamped to it. */
export function resolveLocation(
  bundle: CodeBundle,
  location: { path?: string; startLine?: number; endLine?: number },
): { path: string; startLine: number; endLine: number } | undefined {
  if (!location.path) return undefined;
  const wanted = normalizeEntryPath(location.path);
  const file = bundle.files.find((candidate) => candidate.path === wanted);
  if (!file) return undefined;
  const lines = lineCount(file);
  const start = Math.min(Math.max(1, Math.trunc(location.startLine ?? 1)), lines);
  const end = Math.min(Math.max(start, Math.trunc(location.endLine ?? start)), lines);
  return { path: file.path, startLine: start, endLine: end };
}
