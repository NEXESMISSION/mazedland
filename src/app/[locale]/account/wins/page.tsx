import { redirect } from "@/i18n/navigation";

/**
 * Legacy /account/wins — folded into the unified "Mes activités" hub. Kept
 * as a redirect so old notification links/bookmarks don't 404. Wins are the
 * Gagnées tab there.
 */
export default async function WinsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({
    href: { pathname: "/account/activity", query: { tab: "gagnees" } },
    locale: locale as "ar" | "fr" | "en",
  });
}
