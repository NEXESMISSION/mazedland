/**
 * Locale template — re-mounts on every navigation (unlike layout.tsx, which
 * persists). Wrapping the page in `mazed-page-enter` gives each route swap a
 * short fade+rise so navigation feels smooth instead of snapping abruptly.
 * Auto-disabled for users with prefers-reduced-motion (see globals.css).
 */
export default function LocaleTemplate({ children }: { children: React.ReactNode }) {
  return <div className="mazed-page-enter">{children}</div>;
}
