/**
 * Publier une annonce — the page loads the category tree, the price list, the
 * seller's remaining credits and any draft they left behind before it can render
 * anything, which is the longest wait in the product. It showed nothing at all
 * while that happened, from the one button the whole business depends on.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 lg:py-10">
      <div className="skel h-7 w-64 max-w-full rounded-full lg:h-9" />
      <div className="skel mt-2 h-3 w-80 max-w-full rounded-full" />

      {/* Step markers */}
      <div className="mt-6 flex items-center gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skel h-1.5 flex-1 rounded-full" />
        ))}
      </div>

      <div className="mt-6 space-y-5 rounded-2xl border border-border bg-surface p-4 lg:p-6">
        {/* Category pickers */}
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="skel h-2.5 w-20 rounded-full" />
              <div className="skel mt-2 h-12 w-full rounded-xl" />
            </div>
          ))}
        </div>

        {/* Photo dropzone */}
        <div>
          <div className="skel h-2.5 w-16 rounded-full" />
          <div className="skel mt-2 h-36 w-full rounded-2xl" />
        </div>

        {/* Fields */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="skel h-2.5 w-24 rounded-full" />
            <div className="skel mt-2 h-12 w-full rounded-xl" />
          </div>
        ))}

        <div className="skel h-24 w-full rounded-xl" />
        <div className="skel h-12 w-full rounded-xl" />
      </div>
    </main>
  );
}
