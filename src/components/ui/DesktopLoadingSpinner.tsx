/**
 * Desktop-only loading indicator: one simple centered circular spinner.
 *
 * Rendered inside a route's loading.tsx alongside the existing mobile
 * skeletons. On phones/tablets (< lg) it's hidden, so the skeletons show as
 * before. On desktop (lg+) it's a full-viewport opaque overlay with a single
 * gold ring spinner in the middle — covering the skeleton blocks so desktop
 * gets the clean "one circle" loading state instead of a wall of shimmer.
 *
 * Pure CSS (conic-gradient ring + rotate), no JS, so it costs nothing.
 */
export function DesktopLoadingSpinner() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[60] hidden items-center justify-center bg-[var(--background)] lg:flex"
    >
      <span
        className="size-10 rounded-full animate-[batta-conic-spin_0.8s_linear_infinite]"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0%, transparent 25%, var(--gold) 100%)",
          WebkitMask:
            "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
        }}
      />
    </div>
  );
}
