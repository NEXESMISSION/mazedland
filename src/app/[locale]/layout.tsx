import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { MobileShell } from "@/components/layout/MobileShell";
import { NetworkStatus } from "@/components/layout/NetworkStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { PopupManagerLazy } from "@/components/popups/PopupManagerLazy";
import { WatchlistSync } from "@/components/watchlist/WatchlistSync";
import type { Metadata } from "next";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "brand" });
  return {
    title: { default: `${t("name")} — ${t("domain")}`, template: `%s · ${t("domain")}` },
    description: t("tagline"),
    openGraph: {
      title: `${t("name")} — ${t("domain")}`,
      description: t("tagline"),
      type: "website",
      siteName: t("domain"),
    },
    alternates: {
      languages: {
        fr: "/fr",
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

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToastProvider>
        <NetworkStatus />
        <WatchlistSync />
        <MobileShell>{children}</MobileShell>
        {/* Site-wide admin-managed popup surface. Lazy-loaded (ssr:false)
            so its JS + /api/popups/match fetch stay off the critical path.
            Self-skips admin routes so previews don't compete with live
            broadcasts. See PopupManager.tsx for the lifecycle. */}
        <PopupManagerLazy />
      </ToastProvider>
    </NextIntlClientProvider>
  );
}
