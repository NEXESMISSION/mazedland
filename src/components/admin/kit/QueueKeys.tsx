"use client";

import { useEffect } from "react";

/**
 * Keyboard navigation for a queue: `j` / `k` move between rows, `↑` / `↓` do
 * the same, and Enter opens the focused one — which is free, because a
 * `DataTable` row *is* a link.
 *
 * It works off the DOM rather than off a row list passed as a prop: the rows
 * are server-rendered and carry `data-row-id`, so there is nothing to keep in
 * sync and the shortcuts keep working when the table paginates or filters.
 *
 * Nothing is hijacked while the operator is typing — an `input`, `textarea`,
 * `select` or anything `contenteditable` gets its keystrokes untouched, or `j`
 * would be unusable in the search box directly above the table.
 */
export function QueueKeys() {
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;

      const down = e.key === "j" || e.key === "ArrowDown";
      const up = e.key === "k" || e.key === "ArrowUp";
      if (!down && !up) return;

      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-row-id][href]"),
      );
      if (rows.length === 0) return;

      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const current = rows.findIndex((r) => r === active || r.contains(active));

      // No row focused yet: `j` starts at the top, `k` at the bottom.
      const next =
        current === -1
          ? down
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, current + (down ? 1 : -1)));

      rows[next]?.focus();
      rows[next]?.scrollIntoView({ block: "nearest" });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
