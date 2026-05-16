import { SkeletonBar } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]">
      <section className="batta-surface-navy-luxe rounded-2xl p-6 ring-1 ring-gold/25">
        <div className="flex items-start gap-3">
          <div className="skeleton size-12 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <SkeletonBar height="h-4" width="w-1/2" />
            <SkeletonBar height="h-3" width="w-3/4" />
            <SkeletonBar height="h-3" width="w-1/3" />
          </div>
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <div className="skeleton size-10 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <SkeletonBar height="h-3" width="w-2/5" />
              <SkeletonBar height="h-2.5" width="w-3/4" />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
