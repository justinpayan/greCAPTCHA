"use client";

import hljs from "highlight.js/lib/common";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SourceLocation } from "@/lib/quiz";
import { userFacingMessage } from "@/lib/user-facing-error";

import "highlight.js/styles/github.css";

type CodeFile = { path: string; text: string };

/** Files above this are shown as plain text: highlighting them would stall a timed question. */
const MAX_HIGHLIGHT_CHARS = 200_000;

/** File extensions whose highlight.js language name differs from the extension. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
  py: "python", ipynb: "python", rb: "ruby", rs: "rust", kt: "kotlin", kts: "kotlin",
  cs: "csharp", h: "c", hpp: "cpp", cc: "cpp", cxx: "cpp", hh: "cpp",
  sh: "bash", zsh: "bash", yml: "yaml", md: "markdown", htm: "xml", html: "xml",
  vue: "xml", svelte: "xml", toml: "ini", cfg: "ini", m: "objectivec", pl: "perl",
};

function languageFor(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "Dockerfile") return "dockerfile";
  if (name === "Makefile") return "makefile";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const language = LANGUAGE_BY_EXTENSION[extension] ?? extension;
  return language && hljs.getLanguage(language) ? language : undefined;
}

/**
 * The file as highlighted HTML. highlight.js escapes the source it is given, so the only markup
 * in its output is its own spans; plain text is escaped here for the same guarantee.
 */
function highlighted(file: CodeFile): string {
  const language = languageFor(file.path);
  if (language && file.text.length <= MAX_HIGHLIGHT_CHARS) {
    return hljs.highlight(file.text, { language, ignoreIllegals: true }).value;
  }
  return file.text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function lineCount(text: string): number {
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length;
}

/**
 * The participant's codebase beside the questions: a filterable file list and the selected file
 * with line numbers and syntax highlighting. Read-only, and limited to the files the questions were
 * generated from, so it shows exactly what the model saw.
 */
export function CodeViewer({
  attemptId,
  label,
  anchor,
}: {
  attemptId: string;
  label: string;
  /** The current question's file and lines, offered as a jump rather than opened unasked. */
  anchor?: SourceLocation;
}) {
  const [files, setFiles] = useState<CodeFile[] | null>(null);
  const [error, setError] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [filter, setFilter] = useState("");
  const [showFiles, setShowFiles] = useState(true);
  const [marked, setMarked] = useState<SourceLocation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFiles(null);
    setError("");
    void fetch(`/api/attempts/${encodeURIComponent(attemptId)}/code`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { files?: CodeFile[]; error?: string }
          | null;
        if (!response.ok || !payload?.files) {
          throw new Error(payload?.error ?? "The codebase is unavailable.");
        }
        return payload.files;
      })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setFiles(loaded);
        // Opens on a README when there is one, the way a repository's front page does.
        const readme = loaded.find((file) => /^readme(\.|$)/i.test(file.path));
        setSelectedPath((readme ?? loaded[0])?.path ?? "");
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(userFacingMessage(caught, "The codebase could not be displayed."));
      });
    return () => controller.abort();
  }, [attemptId]);

  // A mark belongs to the question it was jumped to from.
  useEffect(() => setMarked(null), [anchor?.path, anchor?.startLine, anchor?.endLine]);

  const selected = files?.find((file) => file.path === selectedPath) ?? null;
  const html = useMemo(() => (selected ? highlighted(selected) : ""), [selected]);
  const lines = selected ? lineCount(selected.text) : 0;
  const visibleFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (files ?? []).filter((file) => !needle || file.path.toLowerCase().includes(needle));
  }, [files, filter]);
  const anchorAvailable = Boolean(anchor && files?.some((file) => file.path === anchor.path));

  function scrollToLine(line: number) {
    const area = scrollRef.current;
    const target = area?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (area && target) area.scrollTop = Math.max(0, target.offsetTop - area.clientHeight / 3);
  }

  function jumpToAnchor() {
    if (!anchor) return;
    setSelectedPath(anchor.path);
    setMarked(anchor);
  }

  // Scrolls once the jumped-to file has rendered.
  useEffect(() => {
    if (marked && marked.path === selectedPath) scrollToLine(marked.startLine);
  }, [marked, selectedPath, html]);

  const mark = marked && marked.path === selectedPath ? marked : null;

  return (
    <section className="pdf-viewer code-viewer" aria-label={`${label} code`}>
      <header className="pdf-toolbar">
        <strong title={selected?.path ?? label}>{selected?.path ?? label}</strong>
        <div className="pdf-toolbar-controls">
          {anchorAvailable && (
            <button type="button" onClick={jumpToAnchor} title={`${anchor!.path}, lines ${anchor!.startLine}–${anchor!.endLine}`}>
              Show question&rsquo;s code
            </button>
          )}
          <button
            type="button"
            aria-pressed={showFiles}
            onClick={() => setShowFiles((value) => !value)}
          >
            Files
          </button>
        </div>
      </header>
      {error ? (
        <p className="pdf-message error">{error}</p>
      ) : !files ? (
        <p className="pdf-message">Loading codebase…</p>
      ) : (
        <div className={`code-viewer-body${showFiles ? "" : " files-hidden"}`}>
          {showFiles && (
            <nav className="code-file-list" aria-label="Files">
              <input
                className="control"
                type="search"
                placeholder="Filter files"
                aria-label="Filter files"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <ul>
                {visibleFiles.map((file) => {
                  const slash = file.path.lastIndexOf("/");
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        className={file.path === selectedPath ? "active" : ""}
                        aria-current={file.path === selectedPath ? "true" : undefined}
                        title={file.path}
                        onClick={() => setSelectedPath(file.path)}
                      >
                        {slash >= 0 && <span className="code-file-dir">{file.path.slice(0, slash + 1)}</span>}
                        {file.path.slice(slash + 1)}
                      </button>
                    </li>
                  );
                })}
                {visibleFiles.length === 0 && <li className="code-file-empty">No matching files</li>}
              </ul>
            </nav>
          )}
          <div className="code-scroll-area" ref={scrollRef}>
            {selected && (
              <div className="code-file">
                <div className="code-gutter" aria-hidden="true">
                  {Array.from({ length: lines }, (_, index) => (
                    <span
                      key={index}
                      data-line={index + 1}
                      className={
                        mark && index + 1 >= mark.startLine && index + 1 <= mark.endLine
                          ? "marked"
                          : undefined
                      }
                    >
                      {index + 1}
                    </span>
                  ))}
                </div>
                <pre className="code-source">
                  {mark && (
                    <span
                      className="code-mark"
                      aria-hidden="true"
                      style={{
                        top: `calc(${mark.startLine - 1} * var(--code-line-height))`,
                        height: `calc(${mark.endLine - mark.startLine + 1} * var(--code-line-height))`,
                      }}
                    />
                  )}
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
