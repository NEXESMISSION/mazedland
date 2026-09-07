import { Link } from "@/i18n/navigation";
import { RowChevron } from "./LinkPending";
import { COLHEAD, FLAG, ROW_FOCUS } from "./surface";

/**
 * The console's list — flat.
 *
 * It was a bordered, rounded, filled card with a sticky tinted header. Twenty
 * screens each drawing that same box is what made the console read as a page
 * of widgets rather than as one tool, so the box is gone: a hairline under the
 * column names, a hairline under each row, and nothing else. Structure comes
 * from the rules and the spacing.
 *
 * Two things it keeps, because they are load-bearing rather than decorative:
 *
 * - **It is a grid, not a `<table>`.** The whole row has to be clickable, and
 *   an anchor cannot wrap a `<tr>`. A CSS grid lets each row *be* the link:
 *   one tab stop, one focus ring, keyboard-navigable for free. ARIA roles
 *   carry the table semantics a screen reader needs.
 * - **It stays a server component.** Cells arrive as already-rendered
 *   `ReactNode`s and rows carry an `href`, so no callback has to cross the
 *   server/client boundary and no queue needs `"use client"` to list things.
 */

export type Column = {
  key: string;
  /** Usually a string; a node when the header itself is a control. */
  label: React.ReactNode;
  /** Grid track. Defaults to `minmax(0,1fr)`; use `120px` for fixed columns. */
  width?: string;
  align?: "left" | "right";
  /** Hide this column below a breakpoint — the phone gets the essentials. */
  hideBelow?: "sm" | "md" | "lg";
};

export type Row = {
  id: string;
  /** Makes the whole row a link. Omit for a static row. */
  href?: string;
  cells: Record<string, React.ReactNode>;
  /** Left edge marker — for rows that are late, blocked or otherwise urgent. */
  flag?: "warn" | "bad";
};

const HIDE: Record<NonNullable<Column["hideBelow"]>, string> = {
  sm: "hidden sm:block",
  md: "hidden md:block",
  lg: "hidden lg:block",
};

export function DataTable({
  columns,
  rows,
  empty,
  caption,
}: {
  columns: Column[];
  rows: Row[];
  /** Rendered instead of the rows when there are none — always pass one. */
  empty: React.ReactNode;
  /** Screen-reader name for the list. */
  caption?: string;
}) {
  if (rows.length === 0) return <div className="mt-5">{empty}</div>;

  const linkable = rows.some((r) => r.href);
  const template =
    columns.map((c) => c.width ?? "minmax(0,1fr)").join(" ") + (linkable ? " 16px" : "");

  return (
    <div role="table" aria-label={caption} className="mt-5">
      <div
        role="row"
        style={{ gridTemplateColumns: template }}
        className={`grid gap-3 border-b border-border pb-2 ${COLHEAD}`}
      >
        {columns.map((c) => (
          <div
            key={c.key}
            role="columnheader"
            className={`truncate ${c.align === "right" ? "text-right" : ""} ${
              c.hideBelow ? HIDE[c.hideBelow] : ""
            }`}
          >
            {c.label}
          </div>
        ))}
        {linkable && <div aria-hidden />}
      </div>

      <div role="rowgroup">
        {rows.map((row) => {
          const inner = (
            <>
              {columns.map((c) => (
                <div
                  key={c.key}
                  role="cell"
                  className={`min-w-0 self-center text-[13px] text-foreground ${
                    c.align === "right" ? "text-right" : ""
                  } ${c.hideBelow ? HIDE[c.hideBelow] : ""}`}
                >
                  {row.cells[c.key] ?? <span className="text-subtle">—</span>}
                </div>
              ))}
              {/* Only inside a real <Link> — a static row has no pending state
                  to report, and useLinkStatus would have no provider. */}
              {linkable && (row.href ? <RowChevron /> : <span aria-hidden />)}
            </>
          );

          const shared = `group relative grid items-center gap-3 border-b border-border/70 py-2.5 text-start ${
            row.flag ? FLAG[row.flag] : ""
          }`;

          return row.href ? (
            <Link
              key={row.id}
              role="row"
              data-row-id={row.id}
              href={row.href as "/admin"}
              // 25 rows each prefetching the same segment is 25 wasted RSC
              // requests: a row link only changes ?panel=, so there is no new
              // route to warm.
              prefetch={false}
              style={{ gridTemplateColumns: template }}
              className={`${shared} transition hover:bg-[var(--row-hover)] ${ROW_FOCUS}`}
            >
              {inner}
            </Link>
          ) : (
            <div
              key={row.id}
              role="row"
              data-row-id={row.id}
              style={{ gridTemplateColumns: template }}
              className={shared}
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Two-line cell — the pattern every queue needs and every queue reinvents:
 * the thing, and the quiet line under it that says whose it is.
 */
export function Stacked({
  top,
  bottom,
}: {
  top: React.ReactNode;
  bottom?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-foreground">{top}</div>
      {bottom != null && (
        <div className="truncate text-[11.5px] text-subtle">{bottom}</div>
      )}
    </div>
  );
}
