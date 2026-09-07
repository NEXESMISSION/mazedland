import { Link } from "@/i18n/navigation";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS, FLAG } from "./surface";

/**
 * The left pane of a split-pane screen: a dense, scannable column of rows,
 * one of which is selected.
 *
 * Distinct from `DataTable` on purpose. A table is for comparing values down
 * columns — prices, dates, amounts. This is for *choosing what to work on*:
 * two lines, no columns, no photo grid, sized so twenty fit on a laptop
 * screen at once. The detail lives beside it, so the row only has to carry
 * enough to pick from.
 *
 * The selected row is the only place in the console with a filled background,
 * and even there the 2px gold edge is doing most of the work.
 */

export type InboxRow = {
  id: string;
  href: string;
  /** Main line — what the thing is. */
  title: React.ReactNode;
  /** Second line — whose it is, where it is. */
  meta?: React.ReactNode;
  /** Right-aligned top: price, amount. */
  value?: React.ReactNode;
  /** Right-aligned bottom: age, expiry. */
  hint?: React.ReactNode;
  /** Small status dot rendered before the title. */
  lead?: React.ReactNode;
  flag?: "warn" | "bad";
};

export function InboxList({
  rows,
  selectedId,
  empty,
  caption,
}: {
  rows: InboxRow[];
  selectedId?: string | null;
  empty: React.ReactNode;
  caption?: string;
}) {
  if (rows.length === 0) return <div className="p-5">{empty}</div>;

  return (
    <ul aria-label={caption} className="divide-y divide-border/70">
      {rows.map((r) => {
        const selected = r.id === selectedId;
        return (
          <li key={r.id}>
            <Link
              href={r.href as "/admin"}
              data-row-id={r.id}
              aria-current={selected ? "true" : undefined}
              // A row link only changes ?a= — there is no new route to warm,
              // and twenty-five prefetches of the same segment is pure waste.
              prefetch={false}
              className={`${ROW_BASE} ${ROW_FOCUS} ${
                selected ? ROW_SELECTED : r.flag ? FLAG[r.flag] : ROW_IDLE
              }`}
            >
              {r.lead && <span className="mt-[7px] shrink-0">{r.lead}</span>}

              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[13px] ${
                    selected ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                  }`}
                >
                  {r.title}
                </span>
                {r.meta && (
                  <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                    {r.meta}
                  </span>
                )}
              </span>

              {(r.value != null || r.hint != null) && (
                <span className="shrink-0 text-end">
                  {r.value != null && (
                    <span className="batta-tabular block text-[12.5px] font-medium text-foreground/90">
                      {r.value}
                    </span>
                  )}
                  {r.hint != null && (
                    <span className="batta-tabular mt-0.5 block text-[11px] text-subtle">
                      {r.hint}
                    </span>
                  )}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
