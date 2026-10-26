import { redirect } from "@/i18n/navigation";

/**
 * Legacy /watchlist — folded into /account/activity, which is « Mes favoris »
 * and nothing else now (the « Favoris » tab). Kept as a redirect so old
 * notification links, bookmarks, and the back-button history don't 404.
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
