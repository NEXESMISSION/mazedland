import { redirect } from "@/i18n/navigation";

/**
 * Legacy /account/bids — folded into the unified "Mes activités" hub. Kept
 * as a redirect so old links/bookmarks don't 404. Live + ended auctions the
 * user took part in live under the En cours / Participées tabs there.
 */
export default async function BidsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/account/activity", locale: locale as "ar" | "fr" | "en" });
}
