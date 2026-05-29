/**
 * /account/activity loading skeleton — bespoke (not the generic
 * `ListRowsSkeleton`) so the layout matches the real page exactly:
 *
 *   - "Côté acheteur" eyebrow + "Mes achats" h1 + subtitle
 *   - 3-tab strip (En cours · Terminées · Favoris) — the page now
 *     uses 3, not the legacy 5 the old skeleton drew
 *   - N row cards, each mirroring `<Row />` in ActivityTabs.tsx:
 *       72px cover + status pill + title + governorate +
 *       gold price + chip row at the bottom
 *   - Quiet "Vous vendez aussi ?" nudge card at the end
 *
 * The previous skeleton drew 5 tab pills and generic rows with a
 * single status chip — the chip row, gold price line and pill on the
 * cover were all missing, so the swap from skeleton to live caused
 * visible reflow. This file drops the abstraction and inlines the
 * exact card structure ActivityTabs renders.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-16 lg:max-w-[var(--max-w-content)]"
    >
      {/* Eyebrow + title + subtitle — same vertical rhythm as the page. */}
      <div className="batta-skeleton h-2.5 w-24 rounded" />
      <div className="mt-2 batta-skeleton h-7 w-32 rounded" />
      <div className="mt-2 batta-skeleton h-3 w-2/3 rounded" />

      {/* Tab strip — 3 pills matching En cours / Terminées / Favoris. */}
      <div className="mt-4 flex gap-1.5">
        <div className="batta-skeleton h-9 w-28 rounded-full" />
        <div className="batta-skeleton h-9 w-28 rounded-full" />
        <div className="batta-skeleton h-9 w-24 rounded-full" />
      </div>

      {/* Section heading line — ActivityTabs renders a small section
          eyebrow above the rows. */}
      <div className="mt-5 batta-skeleton h-3 w-40 rounded" />

      {/* Row cards. Each mirrors the real `<Row />` footprint:
          72px cover (with status pill on top-left) + body block with
          title / location / gold price / chip row. */}
      <section className="mt-3 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <ActivityRowSkeleton key={i} />
        ))}
      </section>

      {/* "Vous vendez aussi ?" nudge — the page closes with a quiet
          gold-fronted card linking to /sell. Mirroring its silhouette
          here keeps the bottom of the page stable when the real card
          paints in. */}
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface p-4 ring-1 ring-border">
        <div className="batta-skeleton size-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <div className="batta-skeleton h-3.5 w-2/3 rounded" />
          <div className="batta-skeleton h-2.5 w-1/2 rounded" />
        </div>
        <div className="batta-skeleton size-5 shrink-0 rounded" />
      </div>

      <span className="sr-only">Chargement…</span>
    </div>
  );
}

function ActivityRowSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden rounded-xl bg-surface p-3 ring-1 ring-border">
      {/* Cover — 72x72 with a status pill stub in the top-left corner. */}
      <div className="relative size-[72px] shrink-0 overflow-hidden rounded-xl bg-surface-2">
        <div className="batta-skeleton-luxe size-full rounded-none" />
        <div className="batta-skeleton absolute start-1 top-1 h-3 w-14 rounded-full" />
      </div>

      {/* Body — title / location / gold price / chip row. */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="batta-skeleton h-3.5 w-3/4 rounded" />
        <div className="batta-skeleton h-2.5 w-1/3 rounded" />
        {/* Gold price line — taller bar so the skeleton conveys the
            ~16px gradient-gold price the real Row uses. */}
        <div className="batta-skeleton-luxe mt-1 h-4 w-1/2 rounded" />
        {/* Chip row at the bottom — deposit + my-bid + countdown chips.
            Variable widths so it doesn't read as a single bar. */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <div className="batta-skeleton h-4 w-20 rounded-full" />
          <div className="batta-skeleton h-4 w-24 rounded-full" />
          <div className="batta-skeleton h-4 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}
