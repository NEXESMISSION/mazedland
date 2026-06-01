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
        aria-label="Chargement"
        className="size-9 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--gold)]"
      />
    </div>
  );
}
