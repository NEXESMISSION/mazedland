/**
 * /properties loading skeleton — mirrors the editorial grid so the
 * page doesn't reflow when the live data arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-5 lg:max-w-[var(--max-w-wide)]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="skeleton h-2 w-20" />
          <div className="skeleton mt-2 h-6 w-40" />
        </div>
        <div className="skeleton h-5 w-20" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="block">
      <div className="aspect-[4/5] rounded-2xl bg-surface-2" />
      <div className="space-y-2 px-1 pt-3">
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
      </div>
    </div>
  );
}
