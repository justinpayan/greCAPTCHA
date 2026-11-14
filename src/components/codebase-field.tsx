"use client";

import { useRef, useState } from "react";

import { CodeScopePicker, type ListedCodeFile } from "@/components/code-scope-picker";
import { FieldHint } from "@/components/field-hint";
import { MAX_BATCH_MANUSCRIPTS } from "@/lib/batch-manuscripts";
import { MAX_ZIP_BYTES, MAX_ZIP_LABEL, zipTooLargeMessage } from "@/lib/uploads";
import { userFacingMessage } from "@/lib/user-facing-error";

const TOKEN_HINT =
  "Used only to download the code (to list its files, and again when you submit), then discarded; it is never stored. Create one that can only read this repository: on GitHub, a fine-grained token with read-only Contents access to it; on GitLab, a project access token with the read_repository scope. Revoke it afterwards.";

const SCOPE_HINT =
  "Move the files you wrote to the right. Questions are generated only about those files, while the whole codebase is still sent to the model as context. For each file you can name the functions or classes you wrote; leave it blank if you wrote the whole file. Pick nothing to test the whole codebase.";

type Listing = { key: number; files: ListedCodeFile[]; commitSha: string | null };

const BATCH_TOKEN_HINT =
  "One token for every repository in the batch, such as a course organisation's or group's. Used once per repository to download the code, then discarded; it is never stored. Give it read-only access to exactly these repositories, and revoke it afterwards.";

/**
 * The codebase input: a ZIP of the repository (`codebase`), or a link to it on GitHub or GitLab
 * (`repoUrl`) with an optional access token for a private one (`repoToken`).
 *
 * Only the chosen input is rendered, so the form carries exactly one source. The server unpacks or
 * downloads the code, leaves out dependencies, build output, binaries, and secrets, and refuses it
 * if what remains is too large for the chosen model, so the browser only checks a ZIP's own size.
 *
 * Given `onBatchChange`, it also offers a batch mode: several ZIPs (`codebase`, repeated) or one
 * repository link per line (`repoUrls`) sharing one token, each of which becomes its own test.
 *
 * Given `pickContributions`, a single codebase also offers "Which parts of the code did you
 * write?": once the code is uploaded or its repository's files are loaded, the files are listed
 * for the submitter to pick theirs (`codeScope`), and a repository is pinned to the listed commit
 * (`repoCommit`) so the files submitted are the ones picked from.
 */
export function CodebaseField({
  id,
  label = "Codebase",
  error,
  onError,
  batch = false,
  onBatchChange,
  pickContributions = false,
}: {
  id: string;
  label?: string;
  error?: string;
  /** Receives a size refusal as soon as a file is picked, and "" when it clears. */
  onError?: (message: string) => void;
  batch?: boolean;
  /** Offers the Single/Batch choice; without it the field always takes one codebase. */
  onBatchChange?: (batch: boolean) => void;
  /** Offers the file picker for the parts of a single codebase the submitter wrote. */
  pickContributions?: boolean;
}) {
  const [source, setSource] = useState<"zip" | "link">("zip");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoToken, setRepoToken] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingStatus, setListingStatus] = useState<"idle" | "loading">("idle");
  const [listingError, setListingError] = useState("");
  /** Counts listing requests, so a slow answer for a replaced file cannot overwrite a newer one. */
  const requestCount = useRef(0);
  const picking = pickContributions && !batch;

  function resetListing() {
    requestCount.current += 1;
    setListing(null);
    setListingStatus("idle");
    setListingError("");
  }

  function choose(next: "zip" | "link") {
    setSource(next);
    onError?.("");
    resetListing();
  }

  function chooseBatch(next: boolean) {
    onBatchChange?.(next);
    onError?.("");
    resetListing();
  }

  async function loadListing(body: FormData) {
    const request = ++requestCount.current;
    setListing(null);
    setListingError("");
    setListingStatus("loading");
    try {
      const response = await fetch("/api/codebase/preview", { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        files?: ListedCodeFile[];
        commitSha?: string | null;
      };
      if (request !== requestCount.current) return;
      if (!response.ok || !payload.files) {
        throw new Error(payload.error ?? "Unable to list the codebase's files.");
      }
      setListing({ key: request, files: payload.files, commitSha: payload.commitSha ?? null });
    } catch (caught) {
      if (request !== requestCount.current) return;
      setListingError(userFacingMessage(caught, "Unable to list the codebase's files."));
    } finally {
      if (request === requestCount.current) setListingStatus("idle");
    }
  }

  function loadRepoListing() {
    if (!repoUrl.trim()) {
      setListingError("Enter the repository link first.");
      return;
    }
    const body = new FormData();
    body.set("repoUrl", repoUrl.trim());
    if (repoToken.trim()) body.set("repoToken", repoToken.trim());
    void loadListing(body);
  }

  const hint =
    source === "zip"
      ? batch
        ? `Up to ${MAX_BATCH_MANUSCRIPTS} ZIPs, each up to ${MAX_ZIP_LABEL}. Each becomes its own test with its own link. Dependencies, build output, binary files, and files holding secrets (such as .env files and private keys) are left out before anything is sent to the model.`
        : `A ZIP of the repository, up to ${MAX_ZIP_LABEL}. Dependencies, build output, binary files, and files holding secrets (such as .env files and private keys) are left out before anything is sent to the model.`
      : batch
        ? `One GitHub or GitLab repository link per line, up to ${MAX_BATCH_MANUSCRIPTS}. Each becomes its own test with its own link, downloaded when you submit and pinned to the commit it was taken from.`
        : "A GitHub or GitLab repository, or a link to one of its branches, tags, or commits. The code is downloaded when you submit and pinned to the commit it was taken from.";

  return (
    <div className="field full">
      <div className="manuscript-heading">
        <label htmlFor={id}>
          {batch ? "Codebases" : label}
          <FieldHint text={hint} />
        </label>
        <div className="manuscript-options">
          {onBatchChange && (
            <div className="manuscript-source" role="radiogroup" aria-label="How many codebases">
              <button
                type="button"
                role="radio"
                aria-checked={!batch}
                className={!batch ? "active" : ""}
                onClick={() => chooseBatch(false)}
              >
                Single
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={batch}
                className={batch ? "active" : ""}
                onClick={() => chooseBatch(true)}
              >
                Batch
              </button>
            </div>
          )}
          <div className="manuscript-source" role="radiogroup" aria-label="How to provide the code">
            <button
              type="button"
              role="radio"
              aria-checked={source === "zip"}
              className={source === "zip" ? "active" : ""}
              onClick={() => choose("zip")}
            >
              {batch ? "Upload ZIPs" : "Upload ZIP"}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === "link"}
              className={source === "link" ? "active" : ""}
              onClick={() => choose("link")}
            >
              {batch ? "Link to repositories" : "Link to repository"}
            </button>
          </div>
        </div>
      </div>
      {source === "zip" ? (
        <input
          // Remounted on a Single/Batch switch, so files picked for one mode are not kept.
          key={batch ? "batch" : "single"}
          className="control file-control"
          id={id}
          name="codebase"
          type="file"
          accept="application/zip,.zip"
          multiple={batch}
          required
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            const tooLarge = picked.find((one) => one.size > MAX_ZIP_BYTES);
            onError?.(
              !tooLarge
                ? ""
                : batch
                  ? `“${tooLarge.name}”: ${zipTooLargeMessage(tooLarge.size)}`
                  : zipTooLargeMessage(tooLarge.size),
            );
            if (!picking) return;
            if (picked.length !== 1 || tooLarge) return resetListing();
            const body = new FormData();
            body.set("codebase", picked[0]);
            void loadListing(body);
          }}
        />
      ) : (
        <>
          {batch ? (
            <textarea
              className="control"
              id={id}
              name="repoUrls"
              rows={5}
              placeholder={"https://github.com/course/team-1\nhttps://gitlab.com/course/team-2"}
              required
            />
          ) : (
            <input
              className="control"
              id={id}
              name="repoUrl"
              type="url"
              inputMode="url"
              placeholder="https://github.com/owner/repository"
              required
              value={repoUrl}
              onChange={(event) => {
                setRepoUrl(event.target.value);
                // Files picked from another repository do not belong to this one.
                if (listing || listingError) resetListing();
              }}
            />
          )}
          <label className="codebase-token-label" htmlFor={`${id}-token`}>
            Access token{" "}
            <span className="label-note">
              {batch ? "only for private repositories" : "only for a private repository"}
            </span>
            <FieldHint text={batch ? BATCH_TOKEN_HINT : TOKEN_HINT} />
          </label>
          <input
            className="control"
            id={`${id}-token`}
            name="repoToken"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_… or glpat-…"
            value={repoToken}
            onChange={(event) => setRepoToken(event.target.value)}
          />
        </>
      )}
      {picking && (
        <div className="scope-section">
          <div className="scope-heading">
            <span className="field-label field-label-row">
              Which parts of the code did you write?
              <FieldHint text={SCOPE_HINT} />
            </span>
            {source === "link" && (
              <button
                type="button"
                className="secondary scope-load"
                disabled={listingStatus === "loading"}
                onClick={loadRepoListing}
              >
                {listing ? "Reload files" : "Load files"}
              </button>
            )}
          </div>
          {listingStatus === "loading" ? (
            <p className="hint scope-status" role="status">
              {source === "zip" ? "Reading the archive…" : "Downloading the repository…"}
            </p>
          ) : listingError ? (
            <p className="error" role="alert">
              {listingError}
            </p>
          ) : listing ? (
            <>
              {source === "link" && listing.commitSha && (
                <input type="hidden" name="repoCommit" value={listing.commitSha} />
              )}
              <CodeScopePicker key={listing.key} files={listing.files} />
            </>
          ) : (
            <p className="hint scope-status">
              {source === "zip"
                ? "Choose a ZIP above to list its files and pick the ones you wrote."
                : "Load the repository's files to pick the ones you wrote."}{" "}
              Pick nothing to test the whole codebase.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
