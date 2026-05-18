/**
 * Locale-root loading fallback — fires whenever a route segment doesn't
 * ship its own loading.tsx. Neutral skeleton layout (header + card grid)
 * that works for any page, no brand-specific imagery while waiting.
 */
export default function LocaleLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w)] px-4 pt-5 lg:max-w-[var(--max-w-wide)]"
    >
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="skeleton h-2 w-20" />
          <div className="skeleton h-6 w-40" />
        </div>
        <div className="skeleton h-5 w-16" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="block">
            <div className="skeleton aspect-[4/5] rounded-2xl" />
            <div className="space-y-2 px-1 pt-3">
              <div className="skeleton h-3.5 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
