"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** How long a passing notification stays before fading out, unless the pointer or focus is on it. */
export const TOAST_MS = 7_000;
/** Matches the fade-out transition in `.toast`. */
const FADE_MS = 300;

export type ToastItem = {
  /** Changes when the message does, so a new message starts its own 7 seconds. */
  id: string;
  tone: "success" | "error";
  content: ReactNode;
  /** Clears the message the notification shows. */
  onClose: () => void;
  /**
   * Stays until its × is clicked instead of fading. Errors always do, so none goes unread; the
   * page also marks messages that carry something to act on, such as a new test's link.
   */
  persistent?: boolean;
};

/**
 * The page's notifications, floating at the bottom of the window over whatever is showing.
 * Rendered straight into <body>, so no scrolling container or stacking context can hide them.
 */
export function ToastStack({ items }: { items: ToastItem[] }) {
  // Portals need the document, which exists only after the first render in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || items.length === 0) return null;
  return createPortal(
    <div className="toast-stack">
      {items.map((item) => (
        <Toast
          key={item.id}
          tone={item.tone}
          persistent={item.persistent || item.tone === "error"}
          onClose={item.onClose}
        >
          {item.content}
        </Toast>
      ))}
    </div>,
    document.body,
  );
}

/**
 * One notification. A passing one fades out after `TOAST_MS`, or at once when its × is clicked;
 * the time stops running while the pointer is over it or something in it has focus, and whatever
 * was left resumes afterwards. A persistent one waits for its ×.
 */
function Toast({
  tone,
  persistent,
  onClose,
  children,
}: {
  tone: ToastItem["tone"];
  persistent: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(TOAST_MS);
  const close = useRef(onClose);
  close.current = onClose;
  const paused = hovered || focused;

  useEffect(() => {
    if (leaving) {
      const timer = window.setTimeout(() => close.current(), FADE_MS);
      return () => window.clearTimeout(timer);
    }
    if (paused || persistent) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [leaving, paused, persistent]);

  return (
    <div
      className={`toast toast-${tone}${leaving ? " toast-leaving" : ""}`}
      role={tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="toast-body">{children}</div>
      <button
        className="toast-close"
        type="button"
        aria-label="Dismiss this notification"
        title="Dismiss"
        onClick={() => setLeaving(true)}
      >
        ×
      </button>
    </div>
  );
}
