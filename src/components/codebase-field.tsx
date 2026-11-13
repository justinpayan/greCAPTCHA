"use client";

import { useState } from "react";

import { FieldHint } from "@/components/field-hint";
import { MAX_BATCH_MANUSCRIPTS } from "@/lib/batch-manuscripts";
import { MAX_ZIP_BYTES, MAX_ZIP_LABEL, zipTooLargeMessage } from "@/lib/uploads";

const TOKEN_HINT =
  "Used once to download the code, then discarded; it is never stored. Create one that can only read this repository: on GitHub, a fine-grained token with read-only Contents access to it; on GitLab, a project access token with the read_repository scope. Revoke it afterwards.";

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
 */
export function CodebaseField({
  id,
  label = "Codebase",
  error,
  onError,
  batch = false,
  onBatchChange,
}: {
  id: string;
  label?: string;
  error?: string;
  /** Receives a size refusal as soon as a file is picked, and "" when it clears. */
  onError?: (message: string) => void;
  batch?: boolean;
  /** Offers the Single/Batch choice; without it the field always takes one codebase. */
  onBatchChange?: (batch: boolean) => void;
}) {
  const [source, setSource] = useState<"zip" | "link">("zip");

  function choose(next: "zip" | "link") {
    setSource(next);
    onError?.("");
  }

  function chooseBatch(next: boolean) {
    onBatchChange?.(next);
    onError?.("");
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
            const tooLarge = [...(event.target.files ?? [])].find((picked) => picked.size > MAX_ZIP_BYTES);
            onError?.(
              !tooLarge
                ? ""
                : batch
                  ? `“${tooLarge.name}”: ${zipTooLargeMessage(tooLarge.size)}`
                  : zipTooLargeMessage(tooLarge.size),
            );
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
          />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
