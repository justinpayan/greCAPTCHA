"use client";

import { type ReactNode, useMemo, useState } from "react";

export type ListedCodeFile = { path: string; lines: number };

type FolderNode = {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  /** Every file beneath this folder, at any depth. */
  files: string[];
};
type FileNode = { kind: "file"; name: string; path: string; lines: number };
type TreeNode = FolderNode | FileNode;

/** Folders first, then files, each by name, the way an editor's file tree reads. */
function buildTree(files: ListedCodeFile[]): TreeNode[] {
  const root: FolderNode = { kind: "folder", name: "", path: "", children: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let folder = root;
    folder.files.push(file.path);
    for (const [index, segment] of segments.slice(0, -1).entries()) {
      const path = segments.slice(0, index + 1).join("/");
      let next = folder.children.find(
        (child): child is FolderNode => child.kind === "folder" && child.path === path,
      );
      if (!next) {
        next = { kind: "folder", name: segment, path, children: [], files: [] };
        folder.children.push(next);
      }
      next.files.push(file.path);
      folder = next;
    }
    folder.children.push({
      kind: "file",
      name: segments[segments.length - 1],
      path: file.path,
      lines: file.lines,
    });
  }
  const order = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "folder"
          ? -1
          : 1
        : a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }),
    );
    for (const node of nodes) if (node.kind === "folder") order(node.children);
  };
  order(root.children);
  return root.children;
}

/**
 * "Which parts of the code did you write?" as a file picker: the codebase's files on the left, the
 * files the submitter wrote on the right, and arrows between them. Each included file takes an
 * optional note naming the functions or classes that are theirs; without one the whole file is.
 *
 * The picked files travel with the form as `codeScope` (JSON). Nothing picked sends nothing,
 * which leaves the whole codebase in scope.
 */
export function CodeScopePicker({ files }: { files: ListedCodeFile[] }) {
  /** Included files and their notes, in the order they were included. */
  const [included, setIncluded] = useState<Map<string, string>>(() => new Map());
  const [leftSelected, setLeftSelected] = useState<Set<string>>(() => new Set());
  const [rightSelected, setRightSelected] = useState<Set<string>>(() => new Set());

  const leftFiles = useMemo(() => files.filter((file) => !included.has(file.path)), [files, included]);
  const rightFiles = useMemo(() => files.filter((file) => included.has(file.path)), [files, included]);

  function include(paths: Iterable<string>) {
    setIncluded((current) => {
      const next = new Map(current);
      for (const path of paths) if (!next.has(path)) next.set(path, "");
      return next;
    });
    setLeftSelected(new Set());
  }

  function exclude(paths: Iterable<string>) {
    setIncluded((current) => {
      const next = new Map(current);
      for (const path of paths) next.delete(path);
      return next;
    });
    setRightSelected(new Set());
  }

  function setDetail(path: string, detail: string) {
    setIncluded((current) => new Map(current).set(path, detail));
  }

  const scope = rightFiles.map((file) => ({ path: file.path, detail: included.get(file.path) ?? "" }));

  return (
    <div className="scope-picker">
      {scope.length > 0 && <input type="hidden" name="codeScope" value={JSON.stringify(scope)} />}
      <ScopePanel
        title="Codebase"
        emptyText="Every file is included."
        files={leftFiles}
        selected={leftSelected}
        onSelect={setLeftSelected}
        onActivate={include}
        filterable
      />
      <div className="scope-arrows">
        <button
          type="button"
          className="secondary scope-arrow"
          aria-label="Include selected files"
          title="Include selected files"
          disabled={leftSelected.size === 0}
          onClick={() => include(leftSelected)}
        >
          <ArrowIcon direction="right" />
        </button>
        <button
          type="button"
          className="secondary scope-arrow"
          aria-label="Exclude selected files"
          title="Exclude selected files"
          disabled={rightSelected.size === 0}
          onClick={() => exclude(rightSelected)}
        >
          <ArrowIcon direction="left" />
        </button>
      </div>
      <ScopePanel
        title="Your code"
        emptyText="No files picked: questions may cover the whole codebase. Select the files you wrote and move them here."
        files={rightFiles}
        selected={rightSelected}
        onSelect={setRightSelected}
        onActivate={exclude}
        details={included}
        onDetailChange={setDetail}
        expandedByDefault
      />
    </div>
  );
}

/** Drawn rather than typed: a text arrow sits on the font's baseline and is never quite centred. */
function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      className="scope-arrow-icon"
      viewBox="0 0 16 16"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path
        d="M2.5 8h11M9 3.5 13.5 8 9 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScopePanel({
  title,
  emptyText,
  files,
  selected,
  onSelect,
  onActivate,
  details,
  onDetailChange,
  filterable = false,
  expandedByDefault = false,
}: {
  title: string;
  emptyText: string;
  files: ListedCodeFile[];
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  /** Moves these files to the other panel: a double-click on a row. */
  onActivate: (paths: string[]) => void;
  /** Present on the included side: each file's note on the functions that are the submitter's. */
  details?: Map<string, string>;
  onDetailChange?: (path: string, detail: string) => void;
  filterable?: boolean;
  expandedByDefault?: boolean;
}) {
  const [filter, setFilter] = useState("");
  /** Folders opened or closed against the panel's default. */
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());

  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files),
    [files, query],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);
  const visiblePaths = visible.map((file) => file.path);
  const allSelected = visiblePaths.length > 0 && visiblePaths.every((path) => selected.has(path));

  // A filter opens every folder holding a match; otherwise a small codebase starts open.
  const openByDefault = expandedByDefault || Boolean(query) || files.length <= 30;
  const isOpen = (path: string) => openByDefault !== toggled.has(path);

  function toggleFolder(path: string) {
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleSelection(paths: string[], on: boolean) {
    const next = new Set(selected);
    for (const path of paths) {
      if (on) next.add(path);
      else next.delete(path);
    }
    onSelect(next);
  }

  function renderNodes(nodes: TreeNode[], depth: number): ReactNode {
    return nodes.map((node) => {
      const indent = { paddingLeft: `${depth * 16 + 6}px` };
      if (node.kind === "folder") {
        const count = node.files.filter((path) => selected.has(path)).length;
        const open = isOpen(node.path);
        return (
          <li key={node.path} role="treeitem" aria-expanded={open} aria-selected={count === node.files.length}>
            <div className="scope-row" style={indent} onDoubleClick={() => onActivate(node.files)}>
              <button
                type="button"
                className="scope-caret"
                aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                onClick={() => toggleFolder(node.path)}
              >
                <span aria-hidden="true">{open ? "▾" : "▸"}</span>
              </button>
              <label className="scope-name">
                <input
                  type="checkbox"
                  checked={count === node.files.length}
                  ref={(box) => {
                    if (box) box.indeterminate = count > 0 && count < node.files.length;
                  }}
                  onChange={(event) => toggleSelection(node.files, event.target.checked)}
                />
                <span className="scope-folder">{node.name}/</span>
                <span className="scope-meta">{node.files.length}</span>
              </label>
            </div>
            {open && <ul role="group">{renderNodes(node.children, depth + 1)}</ul>}
          </li>
        );
      }
      return (
        <li key={node.path} role="treeitem" aria-selected={selected.has(node.path)}>
          <div
            className="scope-row"
            style={{ paddingLeft: `${depth * 16 + 30}px` }}
            onDoubleClick={() => onActivate([node.path])}
          >
            <label className="scope-name">
              <input
                type="checkbox"
                checked={selected.has(node.path)}
                onChange={(event) => toggleSelection([node.path], event.target.checked)}
              />
              <span className="scope-file">{node.name}</span>
              <span className="scope-meta">
                {node.lines} {node.lines === 1 ? "line" : "lines"}
              </span>
            </label>
          </div>
          {details && onDetailChange && (
            <div className="scope-detail" style={{ paddingLeft: `${depth * 16 + 54}px` }}>
              <input
                className="control"
                aria-label={`Functions or classes you wrote in ${node.path}`}
                value={details.get(node.path) ?? ""}
                maxLength={2000}
                placeholder="Optional: functions or classes you wrote; blank covers the whole file"
                onChange={(event) => onDetailChange(node.path, event.target.value)}
              />
            </div>
          )}
        </li>
      );
    });
  }

  return (
    <section className="scope-panel" aria-label={title}>
      <header className="scope-panel-header">
        <label className="scope-name scope-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={visiblePaths.length === 0}
            aria-label={`Select every file in ${title}`}
            onChange={(event) => toggleSelection(visiblePaths, event.target.checked)}
          />
          <span>{title}</span>
        </label>
        <span className="scope-meta">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </header>
      {filterable && files.length > 0 && (
        <input
          className="control scope-filter"
          type="search"
          value={filter}
          placeholder="Filter files"
          aria-label={`Filter files in ${title}`}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      {files.length === 0 ? (
        <p className="hint scope-empty">{emptyText}</p>
      ) : visible.length === 0 ? (
        <p className="hint scope-empty">No files match.</p>
      ) : (
        <ul className="scope-tree" role="tree" aria-multiselectable="true">
          {renderNodes(tree, 0)}
        </ul>
      )}
    </section>
  );
}
