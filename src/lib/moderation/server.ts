import type { getServiceSupabase } from "@/lib/supabase/admin";
import { publishListing } from "@/lib/listings/publish";
import { asDealType } from "@/lib/listings/deal";
import { checkListing, sameTitle, type CategoryKind, type ReviewFlag } from "./rules";
import { loadSettings } from "@/lib/settings/server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** Statuses that occupy one of a seller's free places. */
const LIVE = ["pending_review", "published"] as const;

export type ModerationSettings = {
  freeLimit: number;
  /** Off: no annonce publishes itself, every one waits for an admin. */
  autoPublish: boolean;
  minPhotos: number;
  /** Distinct reporters that take a published annonce off the catalogue. */
  reportThreshold: number;
  bannedWords: string[];
};

/** What an admin sets in /admin/settings → Modération (registry defaults otherwise). */
export async function moderationSettings(admin: Admin): Promise<ModerationSettings> {
  const s = await loadSettings(admin);
  return {
    freeLimit: s.free_listing_limit,
    autoPublish: s.moderation_auto_publish,
    minPhotos: s.moderation_min_photos,
    reportThreshold: s.moderation_report_threshold,
    bannedWords: s.moderation_banned_words,
  };
}

/** Annonces the seller has live or waiting, not counting `excludeId`. */
export async function liveListingCount(admin: Admin, sellerId: string, excludeId: string): Promise<number> {
  const { count } = await admin
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("seller_id", sellerId)
    .neq("id", excludeId)
    .in("status", LIVE as unknown as string[]);
  return count ?? 0;
}

/**
 * A seller whose annonces may publish themselves: an admin has approved one of
 * theirs before, none of theirs carries the `reported` flag (held for reports,
 * or refused after them — an admin's approval clears it), and they are not
 * banned. Most fraud arrives on a fresh account, so a person's first annonce is
 * always read by a human.
 */
export async function isTrustedSeller(admin: Admin, sellerId: string): Promise<boolean> {
  const [{ data: profile }, { count: approved }, { count: held }] = await Promise.all([
    admin.from("profiles").select("banned_at").eq("id", sellerId).maybeSingle(),
    admin
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", sellerId)
      .not("reviewed_by", "is", null)
      .not("published_at", "is", null),
    admin
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", sellerId)
      .contains("review_flags", ["reported"]),
  ]);
  return !profile?.banned_at && (approved ?? 0) > 0 && (held ?? 0) === 0;
}

export type ListingRow = {
  id: string;
  seller_id: string;
  category_id: string;
  title: string;
  description: string | null;
  price: number | string | null;
  price_on_request: boolean;
  governorate: string;
  attributes: Record<string, unknown> | null;
  fee_payment_id: string | null;
  deal_type?: string | null;
};

export const LISTING_COLUMNS =
  "id, seller_id, category_id, title, description, price, price_on_request, governorate, attributes, fee_payment_id, deal_type";

const area = (attrs: Record<string, unknown> | null) => {
  const n = Number(attrs?.area_sqm);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Every reason this annonce cannot publish itself. Empty means it may.
 * `photoCount` judges a gallery that is not saved yet (an edit of a
 * published annonce, 0172) instead of the one in the database.
 */
export async function reviewFlagsFor(
  admin: Admin,
  listing: ListingRow,
  settings: ModerationSettings,
  opts: { photoCount?: number } = {},
): Promise<ReviewFlag[]> {
  const [{ count: savedPhotos }, { data: cat }, { data: siblings }, trusted] = await Promise.all([
    admin.from("listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", listing.id),
    admin.from("categories").select("kind").eq("id", listing.category_id).maybeSingle(),
    admin
      .from("listings")
      .select("title, price, attributes, category_id, governorate, deal_type")
      .eq("seller_id", listing.seller_id)
      .neq("id", listing.id)
      .in("status", [...LIVE, "pending_payment"]),
    isTrustedSeller(admin, listing.seller_id),
  ]);

  const dealType = asDealType(listing.deal_type);
  const price = listing.price == null ? null : Number(listing.price);
  const myArea = area(listing.attributes);
  const duplicate = (siblings ?? []).some(
    (o) =>
      asDealType(o.deal_type) === dealType &&
      o.category_id === listing.category_id &&
      o.governorate === listing.governorate &&
      (sameTitle(o.title as string, listing.title) ||
        (price != null &&
          Number(o.price) === price &&
          myArea != null &&
          area(o.attributes as Record<string, unknown> | null) === myArea)),
  );

  const flags = checkListing(
    {
      title: listing.title,
      description: listing.description,
      price,
      priceOnRequest: listing.price_on_request,
      areaSqm: myArea,
      kind: (cat?.kind as CategoryKind | undefined) ?? null,
      dealType,
      photoCount: opts.photoCount ?? savedPhotos ?? 0,
      duplicate,
    },
    settings,
  );
  return trusted ? flags : ["first_listing", ...flags];
}

/**
 * The moderation decision for an annonce whose publication is settled (free,
 * credited or paid): straight to the catalogue when nothing stands in the way,
 * otherwise to the admin queue with the reasons. `extra` is merged into the
 * same update (a renewal counts itself, for instance).
 *
 * With auto-publication switched off, nothing takes the first branch: even a
 * clean annonce waits for an admin, its reasons (if any) still recorded.
 */
export async function publishOrQueue(
  admin: Admin,
  listingId: string,
  settings: ModerationSettings,
  extra: Record<string, unknown> = {},
): Promise<
  | { status: "published"; expiresAt: Date; flags: [] }
  | { status: "pending_review"; flags: ReviewFlag[] }
  | { status: "error"; error: unknown }
> {
  const { data: listing, error: readErr } = await admin
    .from("listings")
    .select(LISTING_COLUMNS)
    .eq("id", listingId)
    .maybeSingle();
  if (readErr || !listing) return { status: "error", error: readErr ?? new Error("listing_not_found") };

  const row = listing as unknown as ListingRow;
  const flags = await reviewFlagsFor(admin, row, settings);

  if (flags.length === 0 && settings.autoPublish) {
    const out = await publishListing(admin, row, { reviewerId: null, extra });
    return out.ok ? { status: "published", expiresAt: out.expiresAt, flags: [] } : { status: "error", error: out.error };
  }

  const { error } = await admin
    .from("listings")
    .update({ ...extra, status: "pending_review", rejection_reason: null, review_flags: flags })
    .eq("id", listingId);
  return error ? { status: "error", error } : { status: "pending_review", flags };
}
