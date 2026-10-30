import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { jakarta, cairo } from "./fonts";

/**
 * The page for a URL no route matches.
 *
 * Next's built-in one said "404 · This page could not be found." — in English,
 * unbranded, with no way back. An unmatched URL is resolved before anything
 * streams, so this keeps a real 404 status. (A `notFound()` from inside a page
 * cannot: `[locale]/loading.tsx` has already sent the shell with a 200, and Next
 * marks that page noindex instead — see `[locale]/not-found.tsx`. A catch-all
 * page under [locale] that called notFound() made every unknown URL a soft
 * 404 for the same reason; the QA tour of 2026-10-30 found it, and it is gone.)
 *
 * It sits outside [locale], so it renders its own <html>. Which language the
 * visitor reads comes from the locale the proxy put on the request
 * (next-intl's header): /ar/… gets the Arabic page, right to left, with the
 * French below; /fr/… and everything else, the reverse.
 */

async function requestLocale(): Promise<"fr" | "ar"> {
  const h = await headers();
  return h.get("x-next-intl-locale") === "ar" ? "ar" : "fr";
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  // Absolute: the layout's template (« %s · Mazed Immo ») would name the brand twice.
  return { title: { absolute: locale === "ar" ? "الصفحة غير موجودة — Mazed Immo" : "Page introuvable — Mazed Immo" } };
}

function French({ secondary }: { secondary: boolean }) {
  return (
    <div lang="fr" dir="ltr" className={secondary ? "mt-10 w-full border-t border-border pt-8" : undefined}>
      {secondary ? (
        <h2 className="text-[19px] font-extrabold leading-tight text-foreground">Page introuvable</h2>
      ) : (
        <h1 className="mt-6 text-[22px] font-extrabold leading-tight tracking-tight text-foreground">Page introuvable</h1>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        Le lien que vous avez suivi n&apos;existe pas ou a été déplacé.
      </p>
      <div className={`${secondary ? "mt-5" : "mt-7"} flex flex-wrap items-center justify-center gap-2.5`}>
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
    </div>
  );
}

function Arabic({ secondary }: { secondary: boolean }) {
  return (
    <div
      lang="ar"
      dir="rtl"
      className={secondary ? "mt-10 w-full border-t border-border pt-8" : undefined}
      style={{ fontFamily: "var(--font-arabic)" }}
    >
      {secondary ? (
        <h2 className="text-[19px] font-extrabold leading-tight text-foreground">الصفحة هذي ما لقيناهاش</h2>
      ) : (
        <h1 className="mt-6 text-[22px] font-extrabold leading-tight tracking-tight text-foreground">الصفحة هذي ما لقيناهاش</h1>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        الرابط اللي تبعتو غير موجود ولا تبدّل.
      </p>
      <div className={`${secondary ? "mt-5" : "mt-7"} flex flex-wrap items-center justify-center gap-2.5`}>
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
  );
}

export default async function RootNotFound() {
  const locale = await requestLocale();
  const arabicFirst = locale === "ar";
  return (
    <html lang={locale} dir={arabicFirst ? "rtl" : "ltr"} className={`${jakarta.variable} ${cairo.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground font-sans" style={{ background: "#ffffff" }}>
        <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
          <Image src="/logo-mark.webp" alt="Mazed Immo" width={127} height={160} sizes="48px" className="h-16 w-auto" />
          {arabicFirst ? (
            <>
              <Arabic secondary={false} />
              <French secondary />
            </>
          ) : (
            <>
              <French secondary={false} />
              <Arabic secondary />
            </>
          )}
        </main>
      </body>
    </html>
  );
}
