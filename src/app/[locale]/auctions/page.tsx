import { redirect } from "@/i18n/navigation";

/**
 * The standalone /auctions index was dropped in favour of the unified
 * /properties explore surface. Anyone landing on /auctions (old link,
 * bookmark, typed URL) is sent there instead of hitting a 404.
 * The individual lot route /auctions/[id] still exists.
 */
export default async function AuctionsIndexRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/properties", locale: locale as "ar" | "fr" | "en" });
}
