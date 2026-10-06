import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { jakarta, cairo } from "./fonts";

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
 * It sits outside [locale], so it renders its own <html> and cannot know which
 * language the visitor reads: it says it in both, each with its own way back.
 */
export default function RootNotFound() {
  return (
    <html lang="fr" dir="ltr" className={`${jakarta.variable} ${cairo.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground font-sans" style={{ background: "#ffffff" }}>
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

          <div lang="ar" dir="rtl" className="mt-10 w-full border-t border-border pt-8" style={{ fontFamily: "var(--font-arabic)" }}>
            <h2 className="text-[19px] font-extrabold leading-tight text-foreground">الصفحة هذي ما لقيناهاش</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
              الرابط اللي تبعتو غير موجود ولا تبدّل.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <Link
                href="/ar/annonces"
                className="tap-target inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-[13px] font-bold text-[var(--background)] transition active:scale-[0.98]"
              >
                شوف الإعلانات
              </Link>
              <Link
                href="/ar"
                className="tap-target inline-flex h-11 items-center justify-center rounded-full border border-border px-6 text-[13px] font-bold text-foreground transition hover:bg-surface-2 active:scale-[0.98]"
              >
                الصفحة الرئيسية
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
