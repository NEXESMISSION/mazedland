import { redirect } from "next/navigation";
import { coverPhoto } from "@/lib/listingCover";
import { getLocale } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { categoryLabel } from "@/lib/i18n";
import { governorateLabel } from "@/lib/tunisia";
import { asDealType } from "@/lib/listings/deal";
import { FavoritesList, type SavedItem } from "./FavoritesList";

export const dynamic = "force-dynamic";

/**
 * Mes favoris — the annonces this buyer saved.
 *
 * WHAT STOOD HERE. Five tabs of auction activity: lots you were bidding on,
 * cautions awaiting validation, lots you won, lots you took part in, and
 * favourites. It read `auction_bids_public`, `auction_deposits`, `auctions`
 * and `payments.auction_id` — every one of which was dropped with the auction
 * product. The page kept answering 200 and showed nothing, which is how a
 * Server Component fails.
 *
 * That mattered more than most: this route is a BOTTOM TAB, one of five
 * primary destinations, and `/watchlist`, `/account/bids` and `/account/wins`
 * all redirect into it. Five entry points into a dead page.
 *
 * Of the five tabs, exactly one survives the pivot — favourites — because it
 * is the only one whose subject still exists. So that is the page now, and
 * every one of those links keeps working without a new redirect. (The route
 * keeps its old name; the tab that opens it says « Favoris », like the page.)
 *
 * Expired and archived listings are kept in the list rather than hidden. If
 * someone saved a bien and it came down, "plus disponible" is the answer they
 * came for — silently dropping it looks like we lost their favourite.
 *
 * The list itself is FavoritesList (client): removing one updates it at once.
 */

type ListingRow = {
    id: string; title: string; price: number | null; price_on_request: boolean;
    governorate: string; status: string; deal_type: string | null;
    category: { label_fr: string; label_ar: string | null } | { label_fr: string; label_ar: string | null }[] | null;
    photos: { storage_path: string; sort_order: number; is_cover?: boolean | null }[] | null;
};

type Row = { listing_id: string; listing: ListingRow | ListingRow[] | null };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function ActivityPage() {
  const locale = await getLocale();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/activity`)}`);
  }

  // Read through the service role for the join (listing columns are
  // column-granted), but scoped to this user's own watchlist rows.
  const db = getServiceSupabase() ?? supabase;
  const { data } = await db
    .from("watchlist")
    .select(
      `listing_id,
       listing:listings (
         id, title, price, price_on_request, governorate, status, deal_type,
         category:categories (label_fr, label_ar),
         photos:listing_photos (storage_path, sort_order, is_cover)
       )`,
    )
    .eq("user_id", user.id)
    .not("listing_id", "is", null)
    .order("created_at", { ascending: false });

  const items: SavedItem[] = ((data ?? []) as unknown as Row[])
    .map((r) => one<ListingRow>(r.listing))
    .filter((l): l is ListingRow => l !== null)
    .map((l) => ({
      id: l.id,
      title: l.title,
      category: categoryLabel(one(l.category), locale),
      place: governorateLabel(l.governorate, locale),
      price: l.price == null ? null : Number(l.price),
      priceOnRequest: l.price_on_request,
      rent: asDealType(l.deal_type) === "rent",
      coverPath: coverPhoto(l.photos)?.storage_path ?? null,
      gone: l.status !== "published",
    }));

  return (
    // Narrow on a phone, wide on a desktop. It was max-w-2xl at every width:
    // on a monitor that is a thin column of 80px thumbnails down the middle of
    // an empty screen — a phone list stretched, not a page.
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-6xl lg:px-6 lg:py-10">
      <FavoritesList items={items} />
    </main>
  );
}
