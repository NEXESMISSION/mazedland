import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/LegalPage";
import { PrivacyContent } from "@/components/legal/LegalContent";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.privacy" });
  return { title: t("metaTitle") };
}

// Pure static content — prerender at build and serve from the edge CDN.
export const dynamic = "force-static";

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Static rendering with next-intl: the page must set the locale itself
  // (Next can render it apart from the layout) before any translation call.
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");
  return (
    <LegalPage eyebrow={t("eyebrow")} title={t("privacy.title")} updated="2026">
      <PrivacyContent />
    </LegalPage>
  );
}
