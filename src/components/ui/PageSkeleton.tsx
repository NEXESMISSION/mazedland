/**
 * Console-shaped loading states, so a `loading.tsx` is three lines instead of
 * forty.
 *
 * Why every admin route needs its own file: the App Router only commits a
 * navigation immediately when a loading boundary exists *inside the part of
 * the tree that is changing*. `[locale]/loading.tsx` is an ancestor of every
 * page, so it fires on the first load of the locale and never again —
 * navigating between two console screens had no boundary at all, which is why
 * a click sat there doing nothing until the server had rendered the whole next
 * page.
 *
 * This is a deliberate slice of Auto's file, not the whole thing. Batta already
 * has richer public-page skeletons in `Skeleton.tsx` (`AdminTableSkeleton`,
 * `SkeletonDetailPage`, …); what it lacked was the console shape the ported
 * admin uses. Porting the public ones too would have given the repo two
 * competing answers to "what does a loading listing grid look like".
 *
 * These are deliberately rough. A skeleton is a promise about layout, not a
 * drawing of it: close enough that content lands where the grey was, cheap
 * enough that nobody maintains it.
 */

/** One shimmering block. `.skel` carries the shimmer (see globals.css). */
export function Bar({ w = "w-full", h = "h-3", className = "" }: {
  w?: string; h?: string; className?: string;
}) {
  return <div className={`skel ${h} ${w} rounded-full ${className}`} />;
}

/**
 * The admin console's content area. The rail lives in admin/layout.tsx and
 * stays put, so this fills only the pane that is actually changing.
 */
export function ConsoleSkeleton({ rows = 8, tiles = 0 }: {
  rows?: number; tiles?: number;
}) {
  return (
    <div className="px-6 py-6">
      <Bar w="w-24" h="h-2.5" />
      <Bar w="w-56" h="h-7" className="mt-2" />

      {tiles > 0 && (
        <div className="mt-6 grid gap-px border-y border-border bg-border sm:grid-cols-3">
          {Array.from({ length: tiles }).map((_, i) => (
            <div key={i} className="bg-background px-4 py-4">
              <Bar w="w-20" h="h-2.5" />
              <Bar w="w-12" h="h-6" className="mt-3" />
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 divide-y divide-border border-y border-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-1 py-3">
            <Bar w="w-1.5" h="h-1.5" className="shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar w="w-64" h="h-3.5" />
              <Bar w="w-40" h="h-2.5" />
            </div>
            <Bar w="w-20" h="h-3" />
            <Bar w="w-16" h="h-3" />
          </div>
        ))}
      </div>
    </div>
  );
}
