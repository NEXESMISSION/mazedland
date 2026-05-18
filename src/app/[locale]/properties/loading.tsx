/**
 * /properties loading skeleton — mirrors the sticky search head, the
 * type chip rail and the editorial 2/4-col grid so swapping in the
 * real page doesn't reflow anything under the user's eye.
 *
 * Next.js uses this file as the Suspense fallback automatically: any
 * client-side navigation into /properties paints this within ~16 ms
 * (server is unblocked, no DB roundtrip yet) and streams the real grid
 * in on top once `page.tsx` resolves.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      {/* Sticky search head — mirrors the real layout's input + select + filter button. */}
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

/**
 * Photo block + 2 title lines + price row — same vertical rhythm as
 * `<PropertyCard>` so card-to-card swap is invisible.
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
