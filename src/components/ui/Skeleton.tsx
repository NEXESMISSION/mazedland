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
 * Centered auth-form placeholder — brand mark + N field rows +
 * primary CTA + optional footer link. Mirrors the LoginForm /
 * SignupForm / forgot-password / reset-password footprint so the
 * card doesn't shift when real content swaps in.
 */
export function AuthFormSkeleton({
  fields = 2,
  withFooter = false,
}: {
  /** Number of input rows to render. Login = 2, Signup = 5, etc. */
  fields?: number;
  /** Renders the secondary "Pas encore de compte ?" footer band. */
  withFooter?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-[var(--max-w)] flex-col items-center justify-center px-6">
      <div className="relative w-full max-w-sm">
        <div className="relative overflow-hidden rounded-3xl bg-surface ring-1 ring-border shadow-[var(--shadow-md)]">
          <div aria-hidden className="batta-gradient-gold h-[2px] w-full" />
          <div className="p-7 sm:p-8">
            <div className="flex flex-col items-center text-center">
              <div className="batta-skeleton size-20 rounded-2xl" />
              <div className="mt-5 w-2/3">
                <SkeletonBar height="h-6" width="w-full" />
              </div>
              <div className="mt-2 w-3/4">
                <SkeletonBar height="h-3" width="w-full" />
              </div>
            </div>
            <div className="mt-7 space-y-4">
              {Array.from({ length: fields }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <SkeletonBar height="h-2.5" width="w-1/4" />
                  <SkeletonBar height="h-11" width="w-full" />
                </div>
              ))}
              <SkeletonBar height="h-11" width="w-full" />
            </div>
          </div>
          {withFooter && (
            <div className="border-t border-border bg-surface-2 px-7 py-4 text-center sm:px-8">
              <div className="mx-auto w-2/3">
                <SkeletonBar height="h-3" width="w-full" />
              </div>
            </div>
          )}
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
    <>
      {/* MOBILE / tablet (< lg) — single column, matches the mobile tree. */}
      <div className="mx-auto max-w-xl pb-6 lg:hidden">
        <div className="batta-skeleton aspect-[4/3] rounded-none" />
        <div className="space-y-3 px-4 pt-4">
          <SkeletonBar height="h-5" width="w-3/4" />
          <SkeletonBar height="h-3" width="w-1/2" />
        </div>
        <div className="mx-4 mt-4 rounded-2xl batta-surface-navy p-5">
          <SkeletonBar height="h-3" width="w-1/3" />
          <div className="mt-2">
            <SkeletonBar height="h-8" width="w-2/3" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <SkeletonBar height="h-12" />
            <SkeletonBar height="h-12" />
          </div>
        </div>
        <div className="batta-frame mx-4 mt-3 p-4">
          <SkeletonBar height="h-10" />
        </div>
      </div>

      {/* DESKTOP (lg+) — e-commerce product layout, mirrors AuctionDesktop:
          breadcrumb, then gallery (left) + buy box (right), then full-width
          specs / description / inspection+docs below. */}
      <div className="hidden lg:block mx-auto w-full max-w-[1180px] px-6 pb-24">
        {/* Breadcrumb */}
        <div className="pt-6">
          <SkeletonBar height="h-3" width="w-64" />
        </div>

        {/* Product row: gallery + buy box */}
        <div className="mt-5 grid grid-cols-12 items-start gap-8">
          {/* Left — gallery */}
          <div className="col-span-7">
            <div className="batta-skeleton-luxe aspect-[4/3] rounded-2xl" />
          </div>

          {/* Right — buy box (identity + price card) */}
          <div className="col-span-5 space-y-4">
            <div className="space-y-3">
              <SkeletonBar height="h-7" width="w-28 rounded-full" />
              <SkeletonBar height="h-8" width="w-11/12" />
              <SkeletonBar height="h-3.5" width="w-2/3" />
              <div className="flex gap-2 pt-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonBar key={i} height="h-7" width="w-20 rounded-full" />
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-surface p-6 ring-1 ring-border">
              <SkeletonBar height="h-3" width="w-1/3" />
              <div className="mt-2">
                <SkeletonBar height="h-10" width="w-2/3" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <SkeletonBar height="h-16" width="w-full rounded-xl" />
                <SkeletonBar height="h-16" width="w-full rounded-xl" />
              </div>
              <div className="mt-5">
                <SkeletonBar height="h-12" width="w-full rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Full-width specifications */}
        <div className="batta-frame mt-10 p-6">
          <SkeletonBar height="h-3" width="w-32" />
          <div className="mt-4 grid grid-cols-4 gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonBar key={i} height="h-14" width="w-full rounded-xl" />
            ))}
          </div>
        </div>

        {/* Full-width description */}
        <div className="batta-frame mt-6 space-y-2.5 p-6">
          <SkeletonBar height="h-3" width="w-24" />
          <SkeletonBar height="h-3" width="w-full" />
          <SkeletonBar height="h-3" width="w-11/12" />
          <SkeletonBar height="h-3" width="w-4/5" />
        </div>

        {/* Inspection + documents, 2-col */}
        <div className="mt-6 grid grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-surface p-6 ring-1 ring-border">
              <SkeletonBar height="h-3" width="w-1/3" />
              <div className="mt-3 space-y-2">
                <SkeletonBar height="h-3" width="w-full" />
                <SkeletonBar height="h-3" width="w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Tabbed list-rows skeleton. Used by every /account/* subpage:
 * eyebrow + title + optional tab pills + N stacked rows with a
 * thumbnail, two text lines, and a status chip on the right.
 *
 * `tabs` = 0 hides the tab strip (used by /payments, /inspections
 * which are single-list pages); `withThumb` = false drops the
 * 56-pixel cover image (used by payment-history rows that lead with
 * a kind badge instead of an image).
 */
export function ListRowsSkeleton({
  rows = 5,
  tabs = 0,
  withThumb = true,
}: {
  rows?: number;
  tabs?: number;
  withThumb?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]"
    >
      <div className="space-y-2">
        <SkeletonBar height="h-2.5" width="w-24" />
        <SkeletonBar height="h-6" width="w-44" />
        <SkeletonBar height="h-3" width="w-3/5" />
      </div>
      {tabs > 0 && (
        <div className="hide-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: tabs }).map((_, i) => (
            <div
              key={i}
              className="batta-skeleton h-8 shrink-0 rounded-full"
              style={{ width: 80 + ((i * 17) % 40) }}
            />
          ))}
        </div>
      )}
      <section className="mt-5 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-border"
          >
            {withThumb && (
              <div className="batta-skeleton-luxe size-14 shrink-0 rounded-xl" />
            )}
            <div className="flex-1 space-y-1.5">
              <SkeletonBar height="h-3.5" width="w-2/3" />
              <SkeletonBar height="h-2.5" width="w-1/2" />
            </div>
            <div className="batta-skeleton h-6 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </section>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * Admin table skeleton. Eyebrow + title + summary tiles + filter
 * tab strip + table rows. Switches to stacked cards under the lg
 * breakpoint where the real admin tables also collapse.
 */
export function AdminTableSkeleton({
  rows = 6,
  tiles = 4,
  tabs = 4,
  columns = 5,
}: {
  rows?: number;
  tiles?: number;
  tabs?: number;
  columns?: number;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w-wide)] px-4 py-6"
    >
      <div className="space-y-2">
        <SkeletonBar height="h-2.5" width="w-24" />
        <SkeletonBar height="h-6" width="w-56" />
        <SkeletonBar height="h-3" width="w-2/3" />
      </div>
      {tiles > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: tiles }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl bg-surface p-4 ring-1 ring-border"
            >
              <SkeletonBar height="h-2.5" width="w-1/2" />
              <div className="mt-2">
                <SkeletonBar height="h-6" width="w-1/3" />
              </div>
              <div className="mt-3">
                <SkeletonBar height="h-2" width="w-2/3" />
              </div>
            </div>
          ))}
        </div>
      )}
      {tabs > 0 && (
        <div className="mt-5 flex gap-2 overflow-hidden">
          {Array.from({ length: tabs }).map((_, i) => (
            <div
              key={i}
              className="batta-skeleton h-8 shrink-0 rounded-full"
              style={{ width: 80 + ((i * 13) % 40) }}
            />
          ))}
        </div>
      )}
      {/* Desktop table */}
      <div className="mt-5 hidden overflow-hidden rounded-2xl bg-surface ring-1 ring-border lg:block">
        <div
          className="grid border-b border-border bg-surface-2 p-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <SkeletonBar key={i} height="h-3" width="w-2/3" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="grid items-center gap-3 border-b border-border p-3 last:border-b-0"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, j) => (
              <SkeletonBar
                key={j}
                height="h-3"
                width={
                  j === 0 ? "w-3/4" : j === columns - 1 ? "w-1/2" : "w-3/5"
                }
              />
            ))}
          </div>
        ))}
      </div>
      {/* Mobile cards */}
      <div className="mt-5 space-y-2 lg:hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-surface p-3 ring-1 ring-border"
          >
            <div className="flex items-center gap-3">
              <div className="batta-skeleton-luxe size-12 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <SkeletonBar height="h-3.5" width="w-3/4" />
                <SkeletonBar height="h-2.5" width="w-1/2" />
              </div>
              <div className="batta-skeleton h-6 w-16 shrink-0 rounded-full" />
            </div>
            <div className="mt-3 flex gap-2">
              <div className="batta-skeleton h-8 flex-1 rounded-full" />
              <div className="batta-skeleton h-8 flex-1 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * KYC pipeline step skeleton. Step badge + title + body block
 * (upload box / spinner / verified card) + 1 or 2 CTAs.
 *
 * `variant`:
 *   - "upload": file/camera upload step (id-front, id-back, selfie prep)
 *   - "processing": short spinner page (kyc/processing)
 *   - "status": kyc/status summary card (submitted or verified)
 *   - "intro": kyc/start landing (shield icon + 4-step pill)
 */
export function KycStepSkeleton({
  variant = "upload",
}: {
  variant?: "upload" | "processing" | "status" | "intro";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-md px-4 py-8"
    >
      {variant === "intro" ? (
        <div className="mx-auto batta-skeleton-luxe size-20 rounded-full" />
      ) : variant !== "processing" ? (
        <div className="mx-auto batta-skeleton h-6 w-20 rounded-full" />
      ) : null}

      <div className="mt-5 space-y-2 text-center">
        <SkeletonBar height="h-6" width="w-2/3" className="mx-auto" />
        <SkeletonBar height="h-3" width="w-4/5" className="mx-auto" />
      </div>

      {variant === "upload" && (
        <>
          <div className="batta-skeleton-luxe mt-6 aspect-[4/3] w-full rounded-2xl" />
          <div className="mt-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="batta-skeleton size-6 shrink-0 rounded-full" />
                <SkeletonBar height="h-3" width="w-2/3" />
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="batta-skeleton h-11 rounded-2xl" />
            <div className="batta-skeleton-luxe h-11 rounded-2xl" />
          </div>
        </>
      )}

      {variant === "processing" && (
        <div className="mt-8 flex flex-col items-center gap-5">
          <div className="batta-skeleton-luxe size-16 rounded-full" />
          <div className="w-full space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl bg-surface p-3 ring-1 ring-border"
              >
                <div className="batta-skeleton size-5 shrink-0 rounded-full" />
                <SkeletonBar height="h-3" width="w-2/3" />
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "status" && (
        <>
          <div className="mx-auto batta-skeleton-luxe mt-6 size-16 rounded-full" />
          <div className="mt-5 rounded-2xl bg-surface p-4 ring-1 ring-border">
            <div className="flex items-center gap-3">
              <div className="batta-skeleton size-5 shrink-0 rounded-full" />
              <SkeletonBar height="h-3" width="w-3/4" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="batta-skeleton size-5 shrink-0 rounded-full" />
              <SkeletonBar height="h-3" width="w-2/3" />
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <div className="batta-skeleton-luxe h-11 w-full rounded-2xl" />
            <div className="batta-skeleton h-11 w-full rounded-2xl" />
          </div>
        </>
      )}

      {variant === "intro" && (
        <>
          <div className="mx-auto batta-skeleton mt-5 h-7 w-40 rounded-full" />
          <div className="mt-6">
            <div className="batta-skeleton-luxe h-12 w-full rounded-2xl" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <div className="batta-skeleton size-4 rounded-full" />
            <SkeletonBar height="h-3" width="w-1/2" />
          </div>
        </>
      )}
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * Long-form skeleton. Eyebrow + title + subtitle + N collapsible
 * form sections + submit row. Reused by /sell, /sell/[id]/edit,
 * /sell/[id]/schedule, /inspectors/apply.
 */
export function FormPageSkeleton({
  sections = 4,
  fieldsPerSection = 2,
}: {
  sections?: number;
  fieldsPerSection?: number;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]"
    >
      <div className="space-y-2">
        <SkeletonBar height="h-2.5" width="w-20" />
        <SkeletonBar height="h-6" width="w-2/3" />
        <SkeletonBar height="h-3" width="w-4/5" />
      </div>
      {Array.from({ length: sections }).map((_, s) => (
        <section
          key={s}
          className="mt-5 rounded-2xl bg-surface p-4 ring-1 ring-border"
        >
          <SkeletonBar height="h-4" width="w-1/3" />
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {Array.from({ length: fieldsPerSection }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonBar height="h-2.5" width="w-1/4" />
                <div className="batta-skeleton h-11 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="mt-6 flex justify-end gap-2">
        <div className="batta-skeleton h-11 w-24 rounded-2xl" />
        <div className="batta-skeleton-luxe h-11 w-32 rounded-2xl" />
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * Hero + content skeleton. Dark navy hero band on top, then a
 * card-grid roster. Reused by /inspectors and /partners.
 */
export function HeroWithGridSkeleton({
  cards = 3,
  cols = 3,
}: {
  cards?: number;
  cols?: 2 | 3;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w-wide)]"
    >
      <div className="batta-surface-navy-luxe relative mx-4 mt-4 overflow-hidden rounded-3xl p-7 ring-1 ring-gold/25">
        <SkeletonBar height="h-2.5" width="w-24" />
        <div className="mt-3">
          <SkeletonBar height="h-8" width="w-3/4" />
        </div>
        <div className="mt-3">
          <SkeletonBar height="h-3" width="w-4/5" />
        </div>
        <div className="mt-5 flex gap-2">
          <div className="batta-skeleton-luxe h-10 w-32 rounded-full" />
          <div className="batta-skeleton h-10 w-28 rounded-full" />
        </div>
      </div>
      <section className="mt-7 px-4">
        <div className="flex items-end justify-between">
          <SkeletonBar height="h-5" width="w-40" />
          <SkeletonBar height="h-3" width="w-16" />
        </div>
        <div
          className={`mt-4 grid gap-3 ${
            cols === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"
          }`}
        >
          {Array.from({ length: cards }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl bg-surface p-5 ring-1 ring-border"
            >
              <div className="flex items-center gap-3">
                <div className="batta-skeleton size-12 shrink-0 rounded-2xl" />
                <div className="flex-1 space-y-1.5">
                  <SkeletonBar height="h-3.5" width="w-3/4" />
                  <SkeletonBar height="h-2.5" width="w-1/2" />
                </div>
              </div>
              <div className="mt-4 space-y-1.5">
                <SkeletonBar height="h-3" width="w-full" />
                <SkeletonBar height="h-3" width="w-5/6" />
              </div>
              <div className="mt-4">
                <div className="batta-skeleton h-10 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </section>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * Compact centered status card. Used by /payment/success and
 * /payment/failed: large icon + h1 + body + detail rows + 2 CTAs.
 */
export function CenteredStatusSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex max-w-md flex-col items-center px-5 pt-10"
    >
      <div className="batta-skeleton-luxe size-20 rounded-full" />
      <div className="mt-5 w-full space-y-2 text-center">
        <SkeletonBar height="h-6" width="w-2/3" className="mx-auto" />
        <SkeletonBar height="h-3" width="w-4/5" className="mx-auto" />
      </div>
      <div className="mt-6 w-full rounded-2xl bg-surface p-4 ring-1 ring-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between border-b border-border py-2 last:border-b-0"
          >
            <SkeletonBar height="h-3" width="w-1/3" />
            <SkeletonBar height="h-3" width="w-1/4" />
          </div>
        ))}
      </div>
      <div className="mt-6 w-full space-y-2">
        <div className="batta-skeleton-luxe h-11 w-full rounded-2xl" />
        <div className="batta-skeleton h-11 w-full rounded-2xl" />
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * Bid composer skeleton. Mirrors the bid page layout: header with
 * back link + title + countdown + lot ID, then a 2-col grid (composer
 * + history) on desktop / stacked on mobile.
 */
export function BidPageSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w-wide)] px-4 py-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <SkeletonBar height="h-2.5" width="w-20" />
          <SkeletonBar height="h-5" width="w-56" />
          <SkeletonBar height="h-2.5" width="w-32" />
        </div>
        <div className="batta-skeleton-luxe h-10 w-28 rounded-full" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="batta-surface-navy-luxe rounded-2xl p-5 ring-1 ring-gold/25">
          <SkeletonBar height="h-3" width="w-1/3" />
          <div className="mt-2">
            <SkeletonBar height="h-10" width="w-2/3" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="batta-skeleton h-12 rounded-xl" />
            <div className="batta-skeleton h-12 rounded-xl" />
            <div className="batta-skeleton h-12 rounded-xl" />
          </div>
          <div className="mt-4">
            <div className="batta-skeleton-luxe h-12 w-full rounded-2xl" />
          </div>
        </section>
        <section className="rounded-2xl bg-surface p-4 ring-1 ring-border">
          <SkeletonBar height="h-4" width="w-1/3" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-border py-2 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <div className="batta-skeleton size-7 rounded-full" />
                  <SkeletonBar height="h-3" width="w-20" />
                </div>
                <SkeletonBar height="h-3" width="w-16" />
              </div>
            ))}
          </div>
        </section>
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * Payment checkout skeleton. Cover image + amount block + provider
 * selector + instructions card + upload form.
 */
export function PaymentCheckoutSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[var(--max-w)] pb-8"
    >
      <div className="batta-skeleton-luxe aspect-[4/3] w-full" />
      <div className="px-4 pt-4">
        <SkeletonBar height="h-2.5" width="w-32" />
        <div className="mt-2">
          <SkeletonBar height="h-8" width="w-2/3" />
        </div>
      </div>
      <div className="mt-5 px-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="batta-skeleton h-14 rounded-2xl" />
          <div className="batta-skeleton-luxe h-14 rounded-2xl" />
        </div>
      </div>
      <section className="mx-4 mt-5 rounded-2xl bg-surface p-4 ring-1 ring-border">
        <SkeletonBar height="h-3" width="w-1/3" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-border py-2 last:border-b-0"
            >
              <SkeletonBar height="h-3" width="w-1/3" />
              <SkeletonBar height="h-3" width="w-1/4" />
            </div>
          ))}
        </div>
      </section>
      <section className="mx-4 mt-5">
        <SkeletonBar height="h-4" width="w-1/3" />
        <div className="batta-skeleton-luxe mt-3 aspect-[4/3] w-full rounded-2xl" />
        <div className="mt-3">
          <div className="batta-skeleton-luxe h-12 w-full rounded-2xl" />
        </div>
      </section>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

/**
 * Account hub skeleton. Mobile = identity card + stacked rows; desktop
 * (lg+) = a wide identity banner + a 3-column action-tile grid, mirroring
 * account/page.tsx so the shape doesn't jump when the real page swaps in.
 */
export function AccountSkeleton() {
  return (
    <div role="status" aria-live="polite">
      {/* MOBILE / tablet */}
      <div className="lg:hidden mx-auto max-w-[var(--max-w)] px-4 py-6">
        <section className="batta-surface-navy-luxe rounded-2xl p-6 ring-1 ring-gold/25">
          <div className="flex items-center gap-3">
            <div className="batta-skeleton size-14 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <SkeletonBar height="h-4" width="w-1/2" />
              <SkeletonBar height="h-3" width="w-1/3" />
            </div>
          </div>
        </section>
        <section className="mt-5 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
              <div className="batta-skeleton size-10 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <SkeletonBar height="h-3.5" width="w-2/3" />
                <SkeletonBar height="h-2.5" width="w-1/2" />
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* DESKTOP */}
      <div className="hidden lg:block mx-auto max-w-6xl px-8 py-8">
        <section className="batta-surface-navy-luxe flex items-center justify-between gap-4 rounded-3xl p-7 ring-1 ring-gold/25">
          <div className="flex items-center gap-4">
            <div className="batta-skeleton size-16 shrink-0 rounded-full" />
            <div className="space-y-2">
              <SkeletonBar height="h-5" width="w-48" />
              <SkeletonBar height="h-3" width="w-32" />
            </div>
          </div>
          <div className="batta-skeleton h-10 w-32 rounded-full" />
        </section>
        <div className="mt-6 grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-surface p-5 ring-1 ring-border">
              <div className="batta-skeleton size-11 rounded-2xl" />
              <div className="mt-4 space-y-2">
                <SkeletonBar height="h-4" width="w-1/2" />
                <SkeletonBar height="h-3" width="w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
