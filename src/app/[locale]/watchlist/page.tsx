import { redirect } from "@/i18n/navigation";

/**
 * Legacy /watchlist — folded into the unified "Mes activités" hub. Kept as
 * a redirect so old notification links, bookmarks, and the back-button
 * history don't 404. Favoris is a tab there.
 */
export default async function WatchlistRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({
    href: { pathname: "/account/activity", query: { tab: "favoris" } },
    locale: locale as "ar" | "fr" | "en",
  });
}
