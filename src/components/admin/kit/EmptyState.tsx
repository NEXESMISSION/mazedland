import type { LucideIcon } from "lucide-react";

/**
 * What a list shows when it has nothing to show.
 *
 * Today most admin queues render an empty `<div>` — which, on the screens
 * whose tables hold zero rows, is indistinguishable from a page that failed
 * to load. That ambiguity is a large part of "so much stuff doesn't work":
 * you cannot tell an empty queue from a broken one.
 *
 * So an empty state always says which of the two it is. `tone="idle"` means
 * "nothing is waiting, that's the good outcome"; `tone="filtered"` means
 * "your filters excluded everything" and offers the way back.
 */
export function EmptyState({
  Icon,
  title,
  hint,
  action,
  tone = "idle",
}: {
  Icon: LucideIcon;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "idle" | "filtered";
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface/40 px-6 py-14 text-center">
      <span
        className={`grid size-11 place-items-center rounded-xl ${
          tone === "idle"
            ? "bg-[var(--tone-ok-bg)] text-[var(--tone-ok)]"
            : "bg-surface-2 text-muted"
        }`}
      >
        <Icon className="size-5" strokeWidth={1.9} />
      </span>
      <p className="text-[14px] font-bold text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-[12.5px] leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
