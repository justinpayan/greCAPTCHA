import http from "node:http";
import type { AddressInfo } from "node:net";

import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleFromZip } from "@/lib/code-bundle";
import { readCodebaseSource } from "@/lib/codebase-input";
import {
  allowedGitLabHosts,
  fetchRepoArchive,
  MAX_REPO_ARCHIVE_BYTES,
  parseRepoLink,
  RepoLinkError,
  zipCommitComment,
} from "@/lib/repo-link";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A ZIP with git's commit comment, as GitHub's archives carry. */
function archive(comment = SHA): Buffer {
  const bytes = Buffer.from(
    zipSync({ "owner-repo-0123456/src/main.py": strToU8("print('hi')\n") }),
  );
  // Rewrites the end-of-central-directory record's comment length and appends the comment.
  const eocd = bytes.length - 22;
  bytes.writeUInt16LE(comment.length, eocd + 20);
  return Buffer.concat([bytes, Buffer.from(comment, "latin1")]);
}

type Seen = { url: string; authorization?: string; privateToken?: string };
const seen: Seen[] = [];
let api: http.Server;
let downloads: http.Server;
let apiOrigin = "";
let downloadOrigin = "";

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
}

beforeAll(async () => {
  downloads = http.createServer((request, response) => {
    seen.push({ url: `download${request.url}`, authorization: request.headers.authorization });
    response.writeHead(200, { "Content-Type": "application/zip" });
    response.end(archive());
  });
  downloadOrigin = await listen(downloads);

  api = http.createServer((request, response) => {
    const url = request.url ?? "";
    seen.push({
      url,
      authorization: request.headers.authorization,
      privateToken: request.headers["private-token"] as string | undefined,
    });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", ...headers });
      response.end(JSON.stringify(body));
    };
    // GitHub: the archive endpoint redirects to a separate download host with a signed URL.
    if (url === "/repos/owner/repo/zipball" || url === "/repos/owner/repo/zipball/feature/x") {
      response.writeHead(302, { Location: `${downloadOrigin}/owner/repo/zip/abc?token=signed` });
      return response.end();
    }
    if (url === "/repos/owner/private/zipball") return json(404, { message: "Not Found" });
    if (url === "/repos/owner/limited/zipball") {
      return json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" });
    }
    if (url === "/repos/owner/huge/zipball") {
      response.writeHead(200, { "Content-Length": String(MAX_REPO_ARCHIVE_BYTES + 1) });
      return response.end();
    }
    // GitLab: project, then commit, then the archive pinned to it.
    const project = "/api/v4/projects/group%2Fsub%2Fproject";
    if (url === project) return json(200, { default_branch: "main" });
    if (url === `${project}/repository/commits/main`) return json(200, { id: SHA });
    if (url === `${project}/repository/archive.zip?sha=${SHA}`) {
      response.writeHead(200, { "Content-Type": "application/zip" });
      return response.end(archive(""));
    }
    if (url === "/api/v4/projects/group%2Fsecret") return json(401, { message: "401 Unauthorized" });
    json(404, { message: "Not Found" });
  });
  apiOrigin = await listen(api);
});

afterAll(async () => {
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await new Promise<void>((resolve) => downloads.close(() => resolve()));
});

const local = () => ({ isAllowedAddress: () => true, origin: apiOrigin });

describe("repository links", () => {
  it("reads GitHub repositories, branches, tags, and commits", () => {
    expect(parseRepoLink("https://github.com/owner/repo")).toEqual({
      provider: "github", host: "github.com", owner: "owner", repo: "repo", ref: null,
    });
    expect(parseRepoLink("https://github.com/owner/repo.git").ref).toBeNull();
    expect(parseRepoLink("https://github.com/owner/repo/tree/feature/x").ref).toBe("feature/x");
    expect(parseRepoLink(`https://github.com/owner/repo/commit/${SHA}`).ref).toBe(SHA);
    expect(parseRepoLink("https://github.com/owner/repo/releases/tag/v1.2").ref).toBe("v1.2");
  });

  it("reads GitLab projects, including nested groups and allowed self-hosted instances", () => {
    expect(parseRepoLink("https://gitlab.com/group/sub/project")).toEqual({
      provider: "gitlab", host: "gitlab.com", project: "group/sub/project", ref: null,
    });
    expect(parseRepoLink("https://gitlab.com/group/project/-/tree/dev").ref).toBe("dev");
    const hosts = allowedGitLabHosts("gitlab.cs.example.edu, bad host!");
    expect(hosts).toEqual(["gitlab.com", "gitlab.cs.example.edu"]);
    expect(parseRepoLink("https://gitlab.cs.example.edu/course/team-7", hosts).host).toBe(
      "gitlab.cs.example.edu",
    );
  });

  it("refuses other hosts, plain http, credentials in the link, and links into files", () => {
    expect(() => parseRepoLink("https://gitlab.cs.example.edu/course/team-7", ["gitlab.com"])).toThrow(
      /Only repositories on github.com or gitlab.com/,
    );
    expect(() => parseRepoLink("https://bitbucket.org/a/b")).toThrow(RepoLinkError);
    expect(() => parseRepoLink("http://github.com/owner/repo")).toThrow(/https/);
    expect(() => parseRepoLink("https://user:ghp_x@github.com/owner/repo")).toThrow(/access token in its own field/);
    expect(() => parseRepoLink("https://github.com/owner/repo/blob/main/a.py")).toThrow(/branches, tags, or commits/);
    expect(() => parseRepoLink("https://github.com/owner")).toThrow(/does not name a repository/);
    expect(() => parseRepoLink("https://gitlab.com/project")).toThrow(/does not name a project/);
  });

  it("reads the form's link and token, refusing a link and a ZIP together", () => {
    const form = new FormData();
    form.set("repoUrl", "https://github.com/owner/repo");
    form.set("repoToken", "  github_pat_abc  ");
    expect(readCodebaseSource(form)).toMatchObject({ kind: "link", token: "github_pat_abc" });
    form.set("codebase", new File(["PK"], "code.zip"));
    expect(() => readCodebaseSource(form)).toThrow(/not both/);
  });

  it("reads the commit git writes into an archive's comment", () => {
    expect(zipCommitComment(archive())).toBe(SHA);
    expect(zipCommitComment(archive("not a sha"))).toBeNull();
  });
});

describe("downloading a repository", () => {
  it("follows GitHub's redirect without the token, and pins the commit from the archive", async () => {
    seen.length = 0;
    const result = await fetchRepoArchive(parseRepoLink("https://github.com/owner/repo/tree/feature/x"), {
      ...local(),
      token: "github_pat_secret",
    });
    expect(seen.map((entry) => entry.url)).toEqual([
      "/repos/owner/repo/zipball/feature/x",
      "download/owner/repo/zip/abc?token=signed",
    ]);
    expect(seen[0].authorization).toBe("Bearer github_pat_secret");
    // The download host is another host: the token must not follow the redirect there.
    expect(seen[1].authorization).toBeUndefined();
    expect(result.source).toEqual({
      kind: "repo", host: "github.com", repo: "owner/repo", ref: "feature/x", commitSha: SHA,
    });
    const bundle = bundleFromZip(result.bytes, result.name, result.source);
    expect(bundle.files.map((file) => file.path)).toEqual(["src/main.py"]);
    expect(JSON.stringify(bundle)).not.toContain("github_pat_secret");
  });

  it("downloads a public repository with no token at all", async () => {
    seen.length = 0;
    await fetchRepoArchive(parseRepoLink("https://github.com/owner/repo"), local());
    expect(seen[0].authorization).toBeUndefined();
  });

  it("explains a missing or private repository, a rate limit, and an oversized archive", async () => {
    await expect(fetchRepoArchive(parseRepoLink("https://github.com/owner/private"), local())).rejects.toThrow(
      /If the repository is private, add an access token/,
    );
    await expect(
      fetchRepoArchive(parseRepoLink("https://github.com/owner/private"), { ...local(), token: "github_pat_x" }),
    ).rejects.toThrow(/that the token can read this repository/);
    await expect(fetchRepoArchive(parseRepoLink("https://github.com/owner/limited"), local())).rejects.toThrow(
      /limiting downloads/,
    );
    await expect(fetchRepoArchive(parseRepoLink("https://github.com/owner/huge"), local())).rejects.toThrow(
      /larger than 50 MiB/,
    );
  });

  it("finds GitLab's default branch and commit, and sends the token only as PRIVATE-TOKEN", async () => {
    seen.length = 0;
    const result = await fetchRepoArchive(parseRepoLink("https://gitlab.com/group/sub/project"), {
      ...local(),
      token: "glpat-secret",
    });
    expect(seen.map((entry) => entry.url)).toEqual([
      "/api/v4/projects/group%2Fsub%2Fproject",
      "/api/v4/projects/group%2Fsub%2Fproject/repository/commits/main",
      `/api/v4/projects/group%2Fsub%2Fproject/repository/archive.zip?sha=${SHA}`,
    ]);
    expect(seen.every((entry) => entry.privateToken === "glpat-secret" && !entry.authorization)).toBe(true);
    expect(result).toMatchObject({
      name: "project",
      source: { kind: "repo", host: "gitlab.com", repo: "group/sub/project", ref: "main", commitSha: SHA },
    });
    await expect(
      fetchRepoArchive(parseRepoLink("https://gitlab.com/group/secret"), { ...local(), token: "glpat-old" }),
    ).rejects.toThrow(/rejected the access token/);
  });

  it("refuses a repository host on a private address in production", async () => {
    await expect(
      fetchRepoArchive(parseRepoLink("https://github.com/owner/repo"), { origin: apiOrigin }),
    ).rejects.toThrow(RepoLinkError);
  });
});
