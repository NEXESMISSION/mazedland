import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { routing } from "@/i18n/routing";
import { isRtl } from "@/lib/i18n";
import { jakarta, cairo } from "../fonts";
import { MobileShell } from "@/components/layout/MobileShell";
import { NetworkStatus } from "@/components/layout/NetworkStatus";
import { PWARegister } from "@/components/layout/PWARegister";
import { ToastProvider } from "@/components/ui/Toast";
import { PopupManagerLazy } from "@/components/popups/PopupManagerLazy";
import { FavoritesSync } from "@/components/listing/FavoritesSync";
import { ClientLogger } from "@/components/dev/ClientLogger";
import { ClientErrorReporter } from "@/components/observability/ClientErrorReporter";
import type { Metadata } from "next";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const OG_LOCALE: Record<string, string> = { fr: "fr_TN", ar: "ar_TN" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "brand" });
  const title = `${t("name")} — ${t("titleSuffix")}`;
  // `title.absolute`, not `title.default`.
  //
  // A child segment's `default` still has the PARENT's `template` applied to
  // it, and the root layout's template is "%s · Mazed Immo" — so the home tab
  // read "Mazed Immo — Petites annonces immobilières en Tunisie · Mazed Immo",
  // with the brand said twice. `absolute` is the documented escape hatch and
  // is what a segment's own landing title wants. Inner pages are unaffected:
  // they set a plain string title and keep inheriting the root's template.
  //
  // These used to be built out of `brand.domain`, the pre-rebrand domain. There
  // is no Mazed Immo domain registered yet, so the strings are built from the
  // name and a title suffix instead of inventing one.
  return {
    title: { absolute: title },
    description: t("tagline"),
    openGraph: {
      title,
      description: t("tagline"),
      type: "website",
      siteName: t("name"),
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: t("tagline"),
      images: ["/og.png"],
    },
    alternates: {
      languages: {
        fr: "/fr",
        ar: "/ar",
        "x-default": "/fr",
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Enable static rendering for pages under this layout that opt in (e.g. the
  // home page's `revalidate`). Without this, next-intl reads request headers
  // and forces every route dynamic. Must run before getMessages/getTranslations.
  setRequestLocale(locale);
  const messages = await getMessages();
  const t = await getTranslations("shell");

  // Origin of the Supabase project so the browser can warm a TLS +
  // HTTP/2 connection before we issue the first auth/db/storage call.
  // Skipped when unset (dev with `.env.example` only).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseOrigin = supabaseUrl
    ? (() => { try { return new URL(supabaseUrl).origin; } catch { return null; } })()
    : null;

  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      // Tells Next.js this `scroll-behavior: smooth` is intentional and
      // shouldn't be disabled during route transitions.
      data-scroll-behavior="smooth"
      className={`${jakarta.variable} ${cairo.variable} h-full antialiased`}
      // Inline bg paints with the first HTML byte, before globals.css
      // resolves — keeps the initial paint on-brand.
      style={{ background: "#ffffff" }}
    >
      <head>
        {/*
          Warm TCP + TLS + HTTP/2 connections to origins we hit early
          on every page so the first auth/db/storage call saves the
          ~100–250 ms cold-handshake. preconnect is the strong form
          (full handshake); dns-prefetch is the cheap fallback for
          browsers that ignore preconnect (mostly older WebKit).
        */}
        {supabaseOrigin && (
          <>
            <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        )}
      </head>
      <body
        className="min-h-full bg-background text-foreground font-sans"
        style={{ background: "#ffffff" }}
      >
        {/* Skip link — first focusable element; lets keyboard/screen-reader
            users jump past the nav straight to the page content. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-[var(--gold)] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white focus:shadow-lg"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ToastProvider>
            <NetworkStatus />
            <FavoritesSync />
            <MobileShell>{children}</MobileShell>
            {/* Site-wide admin-managed popup surface. Lazy-loaded (ssr:false)
                so its JS + /api/popups/match fetch stay off the critical path.
                Self-skips admin routes so previews don't compete with live
                broadcasts. See PopupManager.tsx for the lifecycle. */}
            <PopupManagerLazy />
          </ToastProvider>
        </NextIntlClientProvider>
        <PWARegister />
        {/* Ships uncaught client errors + unhandled rejections to the server
            log sink — pairs with instrumentation.ts (server errors) for a
            single, unified observability stream. */}
        <ClientErrorReporter />
        {/* Vercel web analytics + Core Web Vitals (zero-config, no DSN).
            Real-user performance + traffic without a third-party tag.
            Only on Vercel: both load their script from /_vercel/*, which
            exists nowhere else — under `next start` they 404 and log two
            console errors on every page. */}
        {process.env.VERCEL ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
        <Suspense fallback={null}>
          <ClientLogger />
        </Suspense>
      </body>
    </html>
  );
}
