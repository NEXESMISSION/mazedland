import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { MobileShell } from "@/components/layout/MobileShell";
import { ToastProvider } from "@/components/ui/Toast";
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
        ar: "/ar",
        fr: "/fr",
        en: "/en",
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
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToastProvider>
        <MobileShell>{children}</MobileShell>
      </ToastProvider>
    </NextIntlClientProvider>
  );
}
