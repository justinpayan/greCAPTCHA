import "server-only";

import type { IncomingMessage } from "node:http";

import type { CodeBundle } from "@/lib/code-bundle";
import { CodeBundleTooLargeError } from "@/lib/code-bundle";
import { type AddressPolicy, isPublicAddress, PdfLinkError, requestOnce } from "@/lib/pdf-link";
import { logOutgoing } from "@/lib/request-log";

/**
 * Downloading a codebase from a GitHub or GitLab link, in place of an uploaded ZIP.
 *
 * Only the providers' archive endpoints are used, never `git clone`: that would need a git binary
 * and would reach whatever host a link names. Hosts are limited to github.com, gitlab.com, and the
 * GitLab hosts the deployment lists in `CODE_GITLAB_HOSTS`, and every request goes through the
 * same guards as a linked PDF (public addresses only, checked at connection time, redirects
 * vetted hop by hop, a byte cap while streaming, and a deadline).
 *
 * An access token for a private repository is used for this one download and kept nowhere:
 * not in the database, the job payload, or the logs. It is sent only to the provider's API host,
 * and dropped when GitHub redirects to its download host, whose signed URL needs no token.
 */

/** A refusal whose message is meant for the person who submitted the link. */
export class RepoLinkError extends Error {}

/** The most a repository archive may weigh before filtering. Most of a large archive is usually
 * dependencies, data, or binaries, which filtering removes; the bundle limits apply after that. */
export const MAX_REPO_ARCHIVE_BYTES = 50 * 1024 * 1024;
/** API answers (a project's default branch, a commit's ID) are small. */
const MAX_API_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 90_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "greCAPTCHA/1.0 (codebase fetch; +https://grecaptcha.com)";

export type RepoLink =
  | { provider: "github"; host: "github.com"; owner: string; repo: string; ref: string | null }
  | { provider: "gitlab"; host: string; project: string; ref: string | null };

/** gitlab.com plus the self-hosted GitLab instances this deployment allows, lower-cased. */
export function allowedGitLabHosts(configured = process.env.CODE_GITLAB_HOSTS ?? ""): string[] {
  const extra = configured
    .split(/[\s,]+/)
    .map((host) => host.trim().toLowerCase())
    // A dotted host name, optionally with a port: anything else is a typo, not a host.
    .filter((host) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(host));
  return [...new Set(["gitlab.com", ...extra])];
}

const NAME = /^[A-Za-z0-9_.-]+$/;

function decodeSegments(segments: string[]): string {
  try {
    return segments.map((segment) => decodeURIComponent(segment)).join("/");
  } catch {
    throw new RepoLinkError("The link's branch, tag, or commit could not be read.");
  }
}

const shapeMessage =
  "Link to the repository itself, or to one of its branches, tags, or commits.";

/**
 * Reads a pasted repository link without fetching anything: which provider, which repository,
 * and which branch, tag, or commit, if the link names one. A branch whose name contains a slash
 * is read whole, so a link into a folder of a branch is not supported.
 */
export function parseRepoLink(raw: string, gitlabHosts = allowedGitLabHosts()): RepoLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new RepoLinkError("Enter a full link to the repository, starting with https://.");
  }
  if (url.protocol !== "https:") throw new RepoLinkError("Only https:// repository links are supported.");
  if (url.username || url.password) {
    throw new RepoLinkError(
      "Links containing a username or password are not supported. Enter an access token in its own field instead.",
    );
  }
  const host = url.host.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "github.com" || host === "www.github.com") {
    const [owner, rawRepo, kind, ...rest] = segments;
    const repo = rawRepo?.replace(/\.git$/i, "");
    if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) {
      throw new RepoLinkError("That GitHub link does not name a repository. Use https://github.com/owner/repo.");
    }
    let ref: string | null = null;
    if (kind === "tree" && rest.length) ref = decodeSegments(rest);
    else if (kind === "commit" && rest.length === 1) ref = decodeSegments(rest);
    else if (kind === "releases" && rest[0] === "tag" && rest.length === 2) ref = decodeSegments(rest.slice(1));
    else if (kind !== undefined) throw new RepoLinkError(shapeMessage);
    return { provider: "github", host: "github.com", owner, repo, ref };
  }

  if (gitlabHosts.includes(host)) {
    const dash = segments.indexOf("-");
    const projectSegments = (dash >= 0 ? segments.slice(0, dash) : segments).map((segment, index, all) =>
      index === all.length - 1 ? segment.replace(/\.git$/i, "") : segment,
    );
    if (projectSegments.length < 2 || !projectSegments.every((segment) => NAME.test(segment))) {
      throw new RepoLinkError(`That link does not name a project on ${host}. Use https://${host}/group/project.`);
    }
    let ref: string | null = null;
    if (dash >= 0) {
      const [kind, ...rest] = segments.slice(dash + 1);
      if ((kind === "tree" || kind === "commit" || kind === "tags") && rest.length) ref = decodeSegments(rest);
      else throw new RepoLinkError(shapeMessage);
    }
    return { provider: "gitlab", host, project: projectSegments.join("/"), ref };
  }

  throw new RepoLinkError(
    gitlabHosts.length > 1
      ? `Only repositories on github.com or ${gitlabHosts.join(", ")} can be linked. Upload a ZIP for anything else.`
      : "Only repositories on github.com or gitlab.com can be linked. Upload a ZIP for anything else.",
  );
}

type Fetched = { status: number; headers: IncomingMessage["headers"]; body: Buffer };

type FetchOptions = {
  allow: AddressPolicy;
  allowTestHttp: boolean;
  signal: AbortSignal;
};

async function readCapped(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new CodeBundleTooLargeError(archiveTooLargeMessage);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      response.destroy();
      throw new CodeBundleTooLargeError(archiveTooLargeMessage);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const archiveTooLargeMessage =
  `This repository's archive is larger than ${MAX_REPO_ARCHIVE_BYTES / 1024 / 1024} MiB. ` +
  "Upload a ZIP of only the code you wrote instead.";

/**
 * GET through the address guards, following redirects by hand. The secret headers (the token)
 * go only to the host they were meant for; a redirect elsewhere is followed without them.
 */
async function guardedGet(
  start: URL,
  input: { headers: Record<string, string>; secretHeaders: Record<string, string>; maxBytes: number },
  options: FetchOptions,
): Promise<Fetched> {
  const tokenHost = start.host;
  let url = start;
  for (let hop = 0; ; hop += 1) {
    const headers = {
      "User-Agent": USER_AGENT,
      ...input.headers,
      ...(url.host === tokenHost ? input.secretHeaders : {}),
    };
    // Logged by host and path only: a signed download URL carries a token in its query.
    const response = await logOutgoing("repo", `GET ${url.host}${url.pathname}`, () =>
      requestOnce(url, options.allow, options.signal, options.allowTestHttp, headers).then(
        (message) => Object.assign(message, { status: message.statusCode }),
      ),
    );
    const status = response.statusCode ?? 0;
    if (REDIRECT_STATUSES.has(status) && response.headers.location) {
      response.resume();
      if (hop >= MAX_REDIRECTS) throw new RepoLinkError("The repository download redirected too many times.");
      const next = new URL(response.headers.location, url);
      if (next.protocol !== "https:" && !(options.allowTestHttp && next.protocol === "http:")) {
        throw new RepoLinkError("The repository download redirected to an insecure address.");
      }
      url = next;
      continue;
    }
    if (status < 200 || status >= 300) {
      // Error bodies are small and say why (a rate limit, a missing scope); kept for the message.
      const body = await readCapped(response, MAX_API_BYTES).catch(() => Buffer.alloc(0));
      return { status, headers: response.headers, body };
    }
    return { status, headers: response.headers, body: await readCapped(response, input.maxBytes) };
  }
}

/** The commit ID git writes as a ZIP archive's comment, when the archive carries one. */
export function zipCommitComment(bytes: Uint8Array): string | null {
  // The end-of-central-directory record is the last 22 bytes plus a comment of up to 64 KiB.
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (bytes[at] === 0x50 && bytes[at + 1] === 0x4b && bytes[at + 2] === 0x05 && bytes[at + 3] === 0x06) {
      const length = bytes[at + 20] | (bytes[at + 21] << 8);
      const comment = Buffer.from(bytes.subarray(at + 22, at + 22 + length)).toString("latin1").trim();
      return /^[0-9a-f]{40}$/.test(comment) ? comment : null;
    }
  }
  return null;
}

function failure(link: RepoLink, response: Fetched, withToken: boolean): RepoLinkError {
  const where = link.provider === "github" ? "GitHub" : link.host;
  const rateLimited =
    response.status === 429 ||
    (response.status === 403 && response.headers["x-ratelimit-remaining"] === "0");
  if (rateLimited) {
    return new RepoLinkError(
      `${where} is limiting downloads from this server right now. Add an access token, try again later, or upload a ZIP.`,
    );
  }
  if (response.status === 401) {
    return new RepoLinkError(`${where} rejected the access token. Check that it is correct and has not expired.`);
  }
  if (response.status === 404 || response.status === 403) {
    return new RepoLinkError(
      withToken
        ? `${where} could not find that repository, branch, or commit with this token. Check the link, and that the token can read this repository.`
        : `${where} could not find that repository, branch, or commit. If the repository is private, add an access token that can read it.`,
    );
  }
  return new RepoLinkError(`${where} answered HTTP ${response.status}. Try again, or upload a ZIP instead.`);
}

function parseJson<T>(response: Fetched): T {
  try {
    return JSON.parse(response.body.toString("utf8")) as T;
  } catch {
    throw new RepoLinkError("The repository host sent an answer that could not be read. Try again.");
  }
}

export type RepoArchive = { bytes: Uint8Array; name: string; source: CodeBundle["source"] };

/**
 * Downloads the repository's archive, pinned to a commit wherever the provider says which one,
 * so the questions are tied to one exact version of the code.
 *
 * `isAllowedAddress` and `origin` exist for tests, which serve fixtures from localhost; production
 * callers leave them unset.
 */
export async function fetchRepoArchive(
  link: RepoLink,
  options: {
    token?: string;
    isAllowedAddress?: AddressPolicy;
    /** Replaces `https://api.github.com` or `https://<gitlab host>` in tests. */
    origin?: string;
    timeoutMs?: number;
  } = {},
): Promise<RepoArchive> {
  const token = options.token?.trim() || undefined;
  if (token && (token.length > 500 || /\s/.test(token))) throw new RepoLinkError("That access token is not valid.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const fetchOptions: FetchOptions = {
    allow: options.isAllowedAddress ?? isPublicAddress,
    allowTestHttp: Boolean(options.isAllowedAddress),
    signal: controller.signal,
  };
  try {
    if (link.provider === "github") {
      const origin = options.origin ?? "https://api.github.com";
      const refPath = link.ref ? `/${link.ref.split("/").map(encodeURIComponent).join("/")}` : "";
      const response = await guardedGet(
        new URL(`${origin}/repos/${link.owner}/${link.repo}/zipball${refPath}`),
        {
          headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
          secretHeaders: token ? { Authorization: `Bearer ${token}` } : {},
          maxBytes: MAX_REPO_ARCHIVE_BYTES,
        },
        fetchOptions,
      );
      if (response.status !== 200) throw failure(link, response, Boolean(token));
      const bytes = new Uint8Array(response.body);
      return {
        bytes,
        name: link.repo,
        source: {
          kind: "repo",
          host: link.host,
          repo: `${link.owner}/${link.repo}`,
          ref: link.ref ?? "default branch",
          commitSha: zipCommitComment(bytes),
        },
      };
    }

    const base = `${options.origin ?? `https://${link.host}`}/api/v4/projects/${encodeURIComponent(link.project)}`;
    const api = (path: string, maxBytes = MAX_API_BYTES) =>
      guardedGet(
        new URL(`${base}${path}`),
        {
          headers: { Accept: "application/json" },
          secretHeaders: token ? { "PRIVATE-TOKEN": token } : {},
          maxBytes,
        },
        fetchOptions,
      );
    let ref = link.ref;
    if (!ref) {
      const project = await api("");
      if (project.status !== 200) throw failure(link, project, Boolean(token));
      ref = parseJson<{ default_branch?: string }>(project).default_branch ?? null;
      if (!ref) throw new RepoLinkError("This project has no default branch to download. Link to a branch or commit.");
    }
    const commit = await api(`/repository/commits/${encodeURIComponent(ref)}`);
    if (commit.status !== 200) throw failure(link, commit, Boolean(token));
    const sha = parseJson<{ id?: string }>(commit).id;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new RepoLinkError("The repository host did not say which commit to download.");
    const archive = await api(`/repository/archive.zip?sha=${sha}`, MAX_REPO_ARCHIVE_BYTES);
    if (archive.status !== 200) throw failure(link, archive, Boolean(token));
    return {
      bytes: new Uint8Array(archive.body),
      name: link.project.split("/").pop()!,
      source: { kind: "repo", host: link.host, repo: link.project, ref, commitSha: sha },
    };
  } catch (error) {
    if (error instanceof RepoLinkError || error instanceof CodeBundleTooLargeError) throw error;
    if (controller.signal.aborted) {
      throw new RepoLinkError("The repository took too long to download. Try again, or upload a ZIP.");
    }
    if (error instanceof PdfLinkError) {
      // The address guards' refusals are worded for PDFs; the substance is the same.
      throw new RepoLinkError("That repository host is not reachable from this server. Upload a ZIP instead.");
    }
    throw new RepoLinkError("The repository could not be downloaded. Check the link, or upload a ZIP instead.");
  } finally {
    clearTimeout(timer);
  }
}
