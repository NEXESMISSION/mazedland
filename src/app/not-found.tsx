import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page introuvable — Mazed Immo",
};

/**
 * The page for a URL no route matches.
 *
 * Next's built-in one said "404 · This page could not be found." — in English,
 * unbranded, with no way back. An unmatched URL is resolved before anything
 * streams, so this keeps a real 404 status. (A `notFound()` from inside a page
 * cannot: `[locale]/loading.tsx` has already sent the shell with a 200, and Next
 * marks that page noindex instead — see `[locale]/not-found.tsx`.)
 *
 * It renders in the root layout, without the site's header or tab bar, so the
 * two links below are the way back.
 */
export default function RootNotFound() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <Image src="/logo-mark.webp" alt="Mazed Immo" width={745} height={936} sizes="48px" className="h-16 w-auto" />
      <h1 className="mt-6 text-[22px] font-extrabold leading-tight tracking-tight text-foreground">
        Page introuvable
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        Le lien que vous avez suivi n&apos;existe pas ou a été déplacé.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href="/fr/annonces"
          className="tap-target inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-[13px] font-bold text-[var(--background)] transition active:scale-[0.98]"
        >
          Voir les annonces
        </Link>
        <Link
          href="/fr"
          className="tap-target inline-flex h-11 items-center justify-center rounded-full border border-border px-6 text-[13px] font-bold text-foreground transition hover:bg-surface-2 active:scale-[0.98]"
        >
          Accueil
        </Link>
      </div>
    </main>
  );
}
