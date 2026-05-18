/**
 * /auctions loading skeleton — same layout as /properties (the two
 * indexes share chrome). The whole point is the user lands on a page
 * that looks finished while the supabase query resolves; the live
 * grid then slots in invisibly.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      {/* Sticky search head shape — input + governorate select + filter button. */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2">
          <div className="batta-skeleton h-10 flex-1 rounded-full" />
          <div className="batta-skeleton h-10 w-24 rounded-full" />
          <div className="batta-skeleton size-10 rounded-full" />
        </div>
        {/* Type chip rail */}
        <div className="hide-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="batta-skeleton h-7 shrink-0 rounded-full"
              style={{ width: 60 + ((i * 13) % 45) }}
            />
          ))}
        </div>
        {/* Price bucket pills */}
        <div className="hide-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="batta-skeleton h-7 shrink-0 rounded-full"
              style={{ width: 76 + ((i * 11) % 40) }}
            />
          ))}
        </div>
      </div>

      {/* Result count line */}
      <div className="px-4 pt-3">
        <div className="batta-skeleton h-3 w-32" />
      </div>

      {/* Card grid — same gap + breakpoints as the live page. */}
      <div className="mt-4 grid grid-cols-2 gap-3 px-4 pb-6 lg:grid-cols-4 lg:gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

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
