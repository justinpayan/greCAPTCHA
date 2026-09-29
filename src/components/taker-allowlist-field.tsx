"use client";

import { useState } from "react";

import { formatAllowlist } from "@/lib/allowlist";

export function TakerAllowlistField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field full">
      <label htmlFor={id}>Allowed usernames (1 per line)</label>
      <textarea
        className="control"
        id={id}
        value={value}
        rows={4}
        disabled={disabled}
        placeholder="Leave blank to let anyone with the link take this assessment."
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function CreatedTestAllowlistEditor({
  testId,
  allowlist,
  onSaved,
}: {
  testId: string;
  allowlist: string[] | null;
  onSaved: (next: string[] | null) => void;
}) {
  const [text, setText] = useState(formatAllowlist(allowlist));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/templates/${encodeURIComponent(testId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowlist: text }),
      });
      const payload = (await response.json()) as { error?: string; allowlist?: string[] | null };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update the allowlist.");
      const next = payload.allowlist ?? null;
      setText(formatAllowlist(next));
      onSaved(next);
      setStatus(next?.length ? `Restricted to ${next.length} username${next.length === 1 ? "" : "s"}.` : "Anyone with the link can take this test.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the allowlist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="created-test-allowlist">
      <TakerAllowlistField
        id={`allowlist-${testId}`}
        value={text}
        onChange={setText}
        disabled={saving}
      />
      <div className="set-save-row">
        <button className="secondary" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save allowed usernames"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="template-status">{status}</p>}
    </div>
  );
}
