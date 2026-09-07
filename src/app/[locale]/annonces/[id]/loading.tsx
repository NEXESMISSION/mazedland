/**
 * The listing page is the most-clicked destination in the product and had no
 * loading state at all — tapping a card left the catalogue on screen, frozen,
 * for the whole server render.
 *
 * The shape matches the real page (gallery left, price and seller right) so the
 * content lands into the layout it was already occupying instead of shoving it
 * around.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 py-5 lg:px-6 lg:py-8">
      {/* Breadcrumb */}
      <div className="skel h-3 w-40 rounded-full" />

      <div className="mt-4 lg:grid lg:grid-cols-[1fr_380px] lg:gap-8">
        <div className="min-w-0">
          {/* Gallery */}
          <div className="skel aspect-[4/3] w-full rounded-2xl" />
          <div className="mt-2 flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skel size-16 shrink-0 rounded-lg" />
            ))}
          </div>

          {/* Title block — only on phones, where it sits under the gallery */}
          <div className="mt-5 space-y-2 lg:hidden">
            <div className="skel h-5 w-3/4 rounded-full" />
            <div className="skel h-4 w-1/2 rounded-full" />
            <div className="skel h-7 w-40 rounded-full" />
          </div>

          {/* Spec grid */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface p-3">
                <div className="skel h-2.5 w-12 rounded-full" />
                <div className="skel mt-2 h-4 w-16 rounded-full" />
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="mt-6 space-y-2">
            <div className="skel h-3 w-full rounded-full" />
            <div className="skel h-3 w-11/12 rounded-full" />
            <div className="skel h-3 w-4/5 rounded-full" />
          </div>
        </div>

        {/* Price + seller rail */}
        <aside className="mt-6 lg:mt-0">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="skel h-3 w-24 rounded-full" />
            <div className="skel mt-3 h-8 w-44 rounded-full" />
            <div className="skel mt-4 h-11 w-full rounded-xl" />
            <div className="skel mt-2 h-11 w-full rounded-xl" />
            <div className="mt-5 flex items-center gap-3">
              <div className="skel size-11 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skel h-3 w-28 rounded-full" />
                <div className="skel h-2.5 w-20 rounded-full" />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
