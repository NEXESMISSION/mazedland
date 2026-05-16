/**
 * Two reusable skeleton primitives — a single bar and a property-card
 * placeholder. Pull-to-refresh + Next's loading.tsx use these so the
 * user always sees motion instead of a blank wait.
 */

export function SkeletonBar({
  className = "",
  height = "h-3",
  width = "w-full",
}: {
  className?: string;
  height?: string;
  width?: string;
}) {
  return <div className={`batta-skeleton ${height} ${width} ${className}`} />;
}

/**
 * Mirrors PropertyCard's footprint so the grid doesn't reflow when
 * real cards swap in. 5:6 photo + 3 body lines.
 */
export function SkeletonPropertyCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-batta-line bg-batta-surface">
      <div className="batta-skeleton-luxe aspect-[4/5] rounded-none" />
      <div aria-hidden className="batta-gold-rule" />
      <div className="space-y-2 p-3.5">
        <SkeletonBar height="h-3.5" width="w-11/12" />
        <SkeletonBar height="h-3" width="w-1/2" />
        <div className="pt-2">
          <SkeletonBar height="h-2.5" width="w-1/3" />
          <div className="mt-1.5">
            <SkeletonBar height="h-5" width="w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Generic detail-page placeholder. One full-bleed photo block, then
 * a few rows of body content. Matches AuctionDetail's vertical rhythm
 * so the swap doesn't shift content under the user's eye.
 */
export function SkeletonDetailPage() {
  return (
    <div className="mx-auto max-w-xl pb-6">
      <div className="batta-skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-3 px-4 pt-4">
        <SkeletonBar height="h-5" width="w-3/4" />
        <SkeletonBar height="h-3" width="w-1/2" />
      </div>
      <div className="mx-4 mt-4 rounded-2xl batta-surface-navy p-5">
        <SkeletonBar className="bg-white/15" height="h-3" width="w-1/3" />
        <div className="mt-2">
          <SkeletonBar className="bg-white/20" height="h-8" width="w-2/3" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <SkeletonBar className="bg-white/15" height="h-12" />
          <SkeletonBar className="bg-white/15" height="h-12" />
        </div>
      </div>
      <div className="batta-frame mx-4 mt-3 p-4">
        <SkeletonBar height="h-10" />
      </div>
    </div>
  );
}
