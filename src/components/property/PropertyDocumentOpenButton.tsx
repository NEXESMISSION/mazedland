"use client";

import { useState, type ReactNode } from "react";
import { DocumentViewerModal } from "./DocumentViewerModal";

/**
 * Thin client wrapper used by server-rendered document lists. Renders
 * a button with whatever styling/content the caller passes in, and
 * owns the open/close state for a single DocumentViewerModal scoped
 * to the doc id it was handed. This keeps the server-rendered list
 * components stateless while still giving each row its own in-app
 * viewer instead of the old `<a target="_blank">` behavior.
 *
 * Why per-row state instead of a context: with N rows you get N
 * boolean states, all of which evaluate to `false` except the one the
 * user opened — and the modal renders `null` when closed, so the cost
 * is a few booleans, not N modals.
 */
export function PropertyDocumentOpenButton({
  docId,
  title,
  className,
  children,
}: {
  docId: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      <DocumentViewerModal
        open={open}
        onClose={() => setOpen(false)}
        docId={docId}
        title={title}
      />
    </>
  );
}
