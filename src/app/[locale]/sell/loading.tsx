/**
 * Seller dashboard skeleton — header + balance card + 3 stat tiles
 * + listings rail. Maps to the real /sell layout: action-first
 * (balance up top), then the listing list. (No tabs — /sell drops
 * straight into the seller cockpit.)
 */
import { SkeletonBar } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]"
    >
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <SkeletonBar height="h-2.5" width="w-20" />
          <SkeletonBar height="h-6" width="w-40" />
        </div>
        <div className="batta-skeleton-luxe h-10 w-28 rounded-full" />
      </div>

      {/* Balance card */}
      <section className="batta-surface-navy-luxe mt-5 rounded-2xl p-5 ring-1 ring-gold/25">
        <SkeletonBar height="h-2.5" width="w-32" />
        <div className="mt-2">
          <SkeletonBar height="h-9" width="w-1/2" />
        </div>
        <div className="mt-4 flex gap-2">
          <div className="batta-skeleton h-10 flex-1 rounded-full" />
          <div className="batta-skeleton-luxe h-10 flex-1 rounded-full" />
        </div>
      </section>

      {/* 3 stat tiles */}
      <section className="mt-5 grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-surface p-3 ring-1 ring-border"
          >
            <SkeletonBar height="h-2.5" width="w-1/2" />
            <div className="mt-2">
              <SkeletonBar height="h-6" width="w-1/3" />
            </div>
          </div>
        ))}
      </section>

      {/* Listings list */}
      <section className="mt-6">
        <SkeletonBar height="h-4" width="w-32" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-border"
            >
              <div className="batta-skeleton-luxe size-16 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <SkeletonBar height="h-3.5" width="w-3/4" />
                <SkeletonBar height="h-2.5" width="w-1/2" />
                <div className="flex gap-2 pt-1">
                  <div className="batta-skeleton h-5 w-14 rounded-full" />
                  <div className="batta-skeleton h-5 w-14 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
