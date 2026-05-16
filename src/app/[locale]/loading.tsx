import Image from "next/image";

/**
 * Locale-root loading fallback — Suspense boundary fires this while a
 * route segment compiles (dev) or while the server data is still being
 * fetched (prod RSC streaming). Faint centered logo + soft pulse keeps
 * the brand on-screen instead of flashing a blank black page.
 */
export default function LocaleLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full items-center justify-center px-6"
    >
      <Image
        src="/logo.png"
        alt=""
        width={260}
        height={160}
        priority
        className="h-auto w-[180px] sm:w-[220px] opacity-25 animate-pulse"
      />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
