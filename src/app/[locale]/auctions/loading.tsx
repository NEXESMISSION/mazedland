/**
 * /auctions historically redirected to /properties — but if the route
 * still resolves while the redirect is in flight we want the same
 * grid skeleton as /properties so the eye doesn't flicker between
 * shapes. Mirrors src/app/[locale]/properties/loading.tsx.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2">
          <div className="batta-skeleton h-10 flex-1 rounded-full" />
          <div className="batta-skeleton h-10 w-24 rounded-full" />
          <div className="batta-skeleton size-10 rounded-full" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 px-4 pb-6 lg:grid-cols-4 lg:gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="batta-skeleton-luxe aspect-[4/5] rounded-2xl" />
            <div className="space-y-1.5 px-1 pt-3">
              <div className="batta-skeleton h-4 w-3/4 rounded" />
              <div className="batta-skeleton h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
