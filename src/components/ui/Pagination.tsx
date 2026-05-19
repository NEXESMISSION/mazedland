"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Numbered pagination control — [<] [1] [2] [3] … [N] [>].
 *
 * Renders a windowed page list so even 50-page result sets stay tappable
 * on a phone. Always shows the first page, the last page, the current
 * page, and the two pages on either side; gaps are collapsed with "…".
 *
 *   page=1,  total=10   →   < 1 2 3 4 5 … 10 >
 *   page=5,  total=10   →   < 1 … 3 4 5 6 7 … 10 >
 *   page=10, total=10   →   < 1 … 6 7 8 9 10 >
 *
 * Single-page result sets render nothing (the control is meaningless
 * with no other pages to jump to).
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  disabled = false,
  className,
  tone = "light",
}: {
  page: number;
  totalPages: number;
  onPageChange: (next: number) => void;
  disabled?: boolean;
  className?: string;
  /** Color tone — light by default; dark variant available for use over
   * a dark background should one ever return. */
  tone?: "light" | "dark";
}) {
  if (totalPages <= 1) return null;
  const pages = windowedPages(page, totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={
        "flex w-full items-center justify-center gap-1.5 " + (className ?? "")
      }
    >
      <ArrowButton
        label="Page précédente"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
        tone={tone}
      >
        <ChevronLeft className="size-4" strokeWidth={2.4} />
      </ArrowButton>

      <ul className="flex items-center gap-1">
        {pages.map((p, i) =>
          p === "gap" ? (
            <li
              key={`gap-${i}`}
              aria-hidden
              className={
                "px-1 text-[13px] " +
                (tone === "dark"
                  ? "text-white/40"
                  : "text-[var(--foreground-subtle)]")
              }
            >
              …
            </li>
          ) : (
            <li key={p}>
              <PageButton
                page={p}
                active={p === page}
                onClick={() => onPageChange(p)}
                disabled={disabled || p === page}
                tone={tone}
              />
            </li>
          ),
        )}
      </ul>

      <ArrowButton
        label="Page suivante"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= totalPages}
        tone={tone}
      >
        <ChevronRight className="size-4" strokeWidth={2.4} />
      </ArrowButton>
    </nav>
  );
}

function PageButton({
  page,
  active,
  onClick,
  disabled,
  tone,
}: {
  page: number;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone: "light" | "dark";
}) {
  if (active) {
    return (
      <button
        type="button"
        aria-current="page"
        aria-label={`Page ${page}`}
        disabled
        className="batta-gradient-gold tap-target inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[13px] font-extrabold text-white shadow-[var(--shadow-gold)]"
      >
        {page}
      </button>
    );
  }
  if (tone === "dark") {
    return (
      <button
        type="button"
        aria-label={`Aller à la page ${page}`}
        onClick={onClick}
        disabled={disabled}
        className="tap-target inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[13px] font-bold text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
      >
        {page}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Aller à la page ${page}`}
      onClick={onClick}
      disabled={disabled}
      className="tap-target inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-[var(--border)] bg-white px-3 text-[13px] font-bold text-[var(--foreground-muted)] transition-colors hover:border-[var(--gold-soft)] hover:text-[var(--gold)] disabled:opacity-50"
    >
      {page}
    </button>
  );
}

function ArrowButton({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone: "light" | "dark";
  children: React.ReactNode;
}) {
  if (tone === "dark") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="tap-target inline-flex size-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-md transition active:scale-90 disabled:opacity-30"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="tap-target inline-flex size-9 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--foreground-muted)] transition hover:border-[var(--gold-soft)] hover:text-[var(--gold)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * Build the windowed list: always include 1, totalPages, current page,
 * and ±2 around current. Replace runs with "gap".
 */
function windowedPages(page: number, total: number): (number | "gap")[] {
  const span = 1; // pages on either side of `page`
  const out: (number | "gap")[] = [];
  const showFirst = 1;
  const showLast = total;
  // Inclusive bounds of the inner window, clamped to [2 .. total-1].
  const innerStart = Math.max(2, page - span);
  const innerEnd = Math.min(total - 1, page + span);

  out.push(showFirst);
  if (innerStart > 2) out.push("gap");
  for (let p = innerStart; p <= innerEnd; p++) out.push(p);
  if (innerEnd < total - 1) out.push("gap");
  if (total > 1) out.push(showLast);
  return out;
}
