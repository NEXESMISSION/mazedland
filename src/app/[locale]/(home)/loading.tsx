/**
 * Home loading skeleton — mirrors LandingPage's actual rhythm so
 * the swap is invisible: full-bleed hero block, live ticker tape,
 * trending horizontal rail of 5 cards, then a 2/4 col grid.
 *
 * Lives under (home) route group so it ONLY fires on `/` and never
 * leaks into other top-level routes (the prior `[locale]/loading.tsx`
 * still acts as the global fallback for any segment that doesn't
 * ship its own).
 */
export default function HomeLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]"
    >
      {/* Hero banner — full-bleed carousel slot */}
      <div className="px-4 pt-3 lg:hidden">
        <div className="batta-skeleton-luxe aspect-[16/10] w-full rounded-3xl" />
        <div className="mt-3 flex justify-center gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="batta-skeleton h-1.5 w-6 rounded-full" />
          ))}
        </div>
      </div>

      {/* Hero — desktop split (copy + trust left, auto-sliding banner
          right), the full-width search bar, then the live-stats strip. */}
      <div className="hidden px-8 pt-8 lg:block">
        <div className="grid grid-cols-12 items-center gap-10">
          <div className="col-span-5 space-y-5">
            <div className="batta-skeleton h-7 w-48 rounded-full" />
            <div className="space-y-3">
              <div className="batta-skeleton h-10 w-full rounded" />
              <div className="batta-skeleton h-10 w-5/6 rounded" />
              <div className="batta-skeleton h-10 w-2/3 rounded" />
            </div>
            <div className="batta-skeleton h-4 w-3/4 rounded" />
            <div className="flex gap-6 pt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="batta-skeleton size-9 rounded-xl" />
                  <div className="space-y-1.5">
                    <div className="batta-skeleton h-3 w-20 rounded" />
                    <div className="batta-skeleton h-2.5 w-16 rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="col-span-7">
            <div className="batta-skeleton-luxe aspect-[16/11] w-full rounded-2xl" />
          </div>
        </div>
        <div className="batta-skeleton mt-8 h-16 w-full rounded-2xl" />
        <div className="mt-6 grid grid-cols-4 gap-px overflow-hidden rounded-2xl ring-1 ring-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="batta-skeleton h-[88px] w-full rounded-none" />
          ))}
        </div>
      </div>

      {/* Live ticker tape — single thin row */}
      <div className="mt-5 px-4">
        <div className="batta-skeleton h-9 w-full rounded-full" />
      </div>

      {/* Ending soon urgency strip */}
      <div className="mt-4 px-4">
        <div className="batta-skeleton h-14 w-full rounded-2xl" />
      </div>

      {/* Trending rail — header + 5 horizontal cards */}
      <section className="mt-7">
        <div className="flex items-end justify-between gap-3 px-4">
          <div className="space-y-2">
            <div className="batta-skeleton h-2.5 w-24 rounded" />
            <div className="batta-skeleton h-5 w-40 rounded" />
          </div>
          <div className="batta-skeleton h-7 w-20 rounded-full" />
        </div>
        <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-hidden px-4 pb-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <RailCardSkeleton key={i} />
          ))}
        </div>
      </section>

      {/* Nouveautés rail (second rail) */}
      <section className="mt-7">
        <div className="flex items-end justify-between gap-3 px-4">
          <div className="space-y-2">
            <div className="batta-skeleton h-2.5 w-20 rounded" />
            <div className="batta-skeleton h-5 w-36 rounded" />
          </div>
          <div className="batta-skeleton h-7 w-20 rounded-full" />
        </div>
        <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-hidden px-4 pb-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <RailCardSkeleton key={i} />
          ))}
        </div>
      </section>

      {/* Coverage strip — 1 row of pill chips */}
      <section className="mt-6 px-4">
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="batta-skeleton h-8 w-20 shrink-0 rounded-full" />
          ))}
        </div>
      </section>

      {/* "More to explore" grid */}
      <section className="mt-9 px-4">
        <div className="flex items-end justify-between gap-3">
          <div className="batta-skeleton h-5 w-44 rounded" />
          <div className="batta-skeleton h-7 w-20 rounded-full" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <GridCardSkeleton key={i} />
          ))}
        </div>
      </section>

      {/* Browse by type rail */}
      <section className="mt-10 px-4">
        <div className="batta-skeleton h-4 w-32 rounded" />
        <div className="mt-3 flex gap-2 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="batta-skeleton h-10 w-28 shrink-0 rounded-full"
            />
          ))}
        </div>
      </section>

      {/* Final browse band */}
      <section className="mt-10 px-4 pb-10">
        <div className="batta-skeleton-luxe h-24 w-full rounded-2xl" />
      </section>

      <span className="sr-only">Chargement…</span>
    </div>
  );
}

function RailCardSkeleton() {
  return (
    <div className="w-[230px] shrink-0">
      <div className="batta-skeleton-luxe aspect-[4/5] rounded-2xl" />
      <div className="space-y-1.5 px-1 pt-3">
        <div className="batta-skeleton h-4 w-3/4 rounded" />
        <div className="batta-skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}

function GridCardSkeleton() {
  return (
    <div>
      <div className="batta-skeleton-luxe aspect-[4/5] rounded-2xl" />
      <div className="space-y-1.5 px-1 pt-3">
        <div className="batta-skeleton h-4 w-3/4 rounded" />
        <div className="batta-skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}
