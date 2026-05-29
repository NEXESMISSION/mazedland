/**
 * /properties loading skeleton — mirrors `<ExploreGrid />`'s real layout
 * so the swap from skeleton to live content is invisible (no chip-rail
 * vs. pill-row mismatch, no missing title row, no extra "select" element
 * that doesn't exist in the real header).
 *
 * Layout being mirrored (top → bottom):
 *   1) Search input (rounded-full, full width)
 *   2) Filter pill row: 3 chips + Filters button + (right-pushed) gold rule
 *   3) Gold hairline under the sticky header
 *   4) Page title block + view toggle on the right
 *   5) 2-col (mobile) / 4-col (desktop) card grid
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      {/* Sticky header band — mirrors the real layout's full-width search
          input (NO fake select beside it — the real header has none),
          then a row of 3 pill chips + a Filters button. */}
      <div className="px-4 pt-3">
        <div className="batta-skeleton h-11 w-full rounded-full" />
        <div className="hide-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto pb-3">
          {[80, 110, 90, 86].map((w, i) => (
            <div
              key={i}
              className="batta-skeleton h-9 shrink-0 rounded-full"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>
      <div aria-hidden className="batta-gold-rule" />

      {/* Page title row — eyebrow + title + count line on the left, the
          Grid/Reels toggle on the right. Same vertical rhythm as the
          real ExploreGrid title block so swapping in the live content
          doesn't shift anything under the user's eye. */}
      <div className="px-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="batta-skeleton h-2.5 w-24 rounded" />
            <div className="batta-skeleton h-7 w-44 rounded" />
            <div className="batta-skeleton h-3 w-40 rounded" />
          </div>
          <div className="shrink-0 pt-1">
            <div className="batta-skeleton h-9 w-20 rounded-full" />
          </div>
        </div>

        {/* Card grid — same gap + breakpoints as the live page. */}
        <div className="mt-5 grid grid-cols-2 gap-3 pb-10 lg:grid-cols-4 lg:gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Photo block + 2 title lines + price row — same vertical rhythm as
 * `<GridCard>` so card-to-card swap is invisible.
 */
function CardSkeleton() {
  return (
    <div className="block">
      <div className="batta-skeleton-luxe aspect-[4/5] rounded-2xl" />
      <div className="space-y-1.5 px-1 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="batta-skeleton h-4 w-3/4 rounded" />
          <div className="batta-skeleton mt-0.5 h-2.5 w-8 rounded" />
        </div>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="batta-skeleton h-4 w-1/2 rounded" />
          <div className="batta-skeleton h-3 w-10 rounded" />
        </div>
      </div>
    </div>
  );
}
