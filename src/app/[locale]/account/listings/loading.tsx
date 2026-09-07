/**
 * Mes annonces — reached from the header, the account menu and from every
 * notification the publishing flow sends, and it had no loading state, so each
 * of those routes ended in a pause on the previous page.
 *
 * Mirrors the real page: header, status tabs, then cards on a phone and a table
 * from lg up.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-6xl lg:px-8 lg:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="skel h-7 w-52 rounded-full lg:h-9" />
          <div className="skel mt-2 h-3 w-60 max-w-full rounded-full" />
        </div>
        <div className="skel h-11 w-32 rounded-xl" />
      </div>

      {/* Status tabs */}
      <div className="mt-5 flex gap-2 overflow-hidden">
        {[84, 96, 92, 104, 96].map((w, i) => (
          <div key={i} className="skel h-11 shrink-0 rounded-xl" style={{ width: w }} />
        ))}
      </div>

      {/* Phone: cards */}
      <div className="mt-4 space-y-3 lg:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-3">
            <div className="flex gap-3">
              <div className="skel size-[74px] shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="skel h-3 w-24 rounded-full" />
                <div className="skel h-4 w-4/5 rounded-full" />
                <div className="skel h-4 w-28 rounded-full" />
              </div>
            </div>
            <div className="skel mt-3 h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="mt-5 hidden overflow-hidden rounded-2xl border border-border bg-surface lg:block">
        <div className="flex items-center gap-4 bg-surface-2 px-5 py-3.5">
          {[120, 70, 60, 70, 60, 60].map((w, i) => (
            <div key={i} className="skel h-2.5 rounded-full" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-border px-5 py-3.5">
            <div className="skel size-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skel h-3.5 w-64 max-w-full rounded-full" />
              <div className="skel h-2.5 w-24 rounded-full" />
            </div>
            <div className="skel h-5 w-20 rounded-full" />
            <div className="skel h-4 w-24 rounded-full" />
            <div className="skel h-4 w-20 rounded-full" />
            <div className="skel h-8 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </main>
  );
}
