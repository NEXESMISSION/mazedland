/**
 * The Social Publisher's database side (0170): settings, the annonce as the
 * generator reads it, and the life of a request — asked (with consent),
 * approved into jobs, refused, followed up.
 *
 * Everything here runs with the service role, from routes that have already
 * checked who is asking.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/siteUrl";
import { coverPhoto } from "@/lib/listingCover";
import { asDealType, type DealType } from "@/lib/listings/deal";
import {
  MAX_PHOTOS, OFFERED_CHANNELS, OPEN_REQUEST_STATUSES, requestStatusFrom,
  type JobAction, type JobStatus, type RequestStatus, type SocialChannel, type SocialLanguage,
} from "./channels";
import { generatePost, socialListingFrom, type SocialListing } from "./content";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** The wording the seller agreed to; bump it when the consent text changes. */
export const CONSENT_VERSION = "2026-10-social-v1";

export type SocialSettings = { enabled: boolean; priceTnd: number; autoApprove: boolean; dailyLimit: number };

export async function socialSettings(admin: Admin): Promise<SocialSettings> {
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["social_enabled", "social_price_tnd", "social_auto_approve", "social_daily_limit"]);
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));
  const price = Number(byKey.get("social_price_tnd"));
  const limit = Number(byKey.get("social_daily_limit"));
  return {
    enabled: byKey.get("social_enabled") !== false,
    priceTnd: Number.isFinite(price) && price >= 0 ? price : 0,
    autoApprove: byKey.get("social_auto_approve") === true,
    dailyLimit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10,
  };
}

/** The site's address for the links in a post; the request's own origin when it has none (local). */
export function socialOrigin(fallback?: string | null): string {
  return siteUrl() ?? fallback?.replace(/\/+$/, "") ?? "https://mazedland.vercel.app";
}

/**
 * « Now » for a job's run_after, a minute early. The queue compares it with
 * the database's clock (claim_social_jobs), and a server a few seconds ahead
 * would leave a job it has just approved waiting for the next run.
 */
export function dueNow(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

/** Today in Tunis, as YYYY-MM-DD. */
export function tunisToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Tunis" });
}

const LISTING_SELECT = `id, seller_id, status, title, deal_type, price, price_on_request, governorate, delegation,
  attributes, furnished, available_from,
  category:categories (slug, label_fr, label_ar, kind),
  photos:listing_photos (storage_path, sort_order, is_cover)`;

export type SocialListingRow = {
  id: string;
  seller_id: string;
  status: string;
  title: string;
  deal_type: string | null;
  kind: string | null;
  listing: SocialListing;
  /** Storage paths, cover first. */
  photos: string[];
};

type RawListing = {
  id: string; seller_id: string; status: string; title: string; deal_type: string | null;
  price: number | string | null; price_on_request: boolean | null; governorate: string; delegation: string | null;
  attributes: Record<string, unknown> | null; furnished: string | null; available_from: string | null;
  category: { slug: string; label_fr: string; label_ar: string | null; kind: string } | { slug: string; label_fr: string; label_ar: string | null; kind: string }[] | null;
  photos: { storage_path: string; sort_order: number; is_cover?: boolean | null }[] | null;
};

/** Cover first, then the seller's order. */
export function orderedPhotos(photos: { storage_path: string; sort_order: number; is_cover?: boolean | null }[] | null): string[] {
  const list = (photos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const cover = coverPhoto(list);
  return [...(cover ? [cover] : []), ...list.filter((p) => p !== cover)].map((p) => p.storage_path);
}

export async function loadSocialListing(admin: Admin, listingId: string): Promise<SocialListingRow | null> {
  const { data } = await admin.from("listings").select(LISTING_SELECT).eq("id", listingId).maybeSingle();
  if (!data) return null;
  const raw = data as unknown as RawListing;
  const category = Array.isArray(raw.category) ? raw.category[0] ?? null : raw.category;
  return {
    id: raw.id,
    seller_id: raw.seller_id,
    status: raw.status,
    title: raw.title,
    deal_type: raw.deal_type,
    kind: category?.kind ?? null,
    listing: socialListingFrom({ ...raw, category }),
    photos: orderedPhotos(raw.photos),
  };
}

/** The text of every channel asked, ready to store (or to preview). */
export function buildVariants(input: {
  row: SocialListingRow;
  channels: SocialChannel[];
  language: SocialLanguage;
  origin: string;
  ref: string;
  today: string;
}) {
  return input.channels.map((channel) => {
    const post = generatePost({
      listing: input.row.listing,
      channel,
      language: input.language,
      origin: input.origin,
      ref: input.ref,
      today: input.today,
    });
    return {
      channel,
      body: post.body,
      generated_body: post.body,
      link_url: post.linkUrl,
      photo_paths: input.row.photos.slice(0, MAX_PHOTOS[channel]),
    };
  });
}

// ── Groups ─────────────────────────────────────────────────────────────────

export type GroupRow = {
  id: string;
  name: string;
  url: string;
  governorates: string[];
  deal_types: string[];
  category_kinds: string[];
  allows_links: boolean;
  status: string;
  members: number | null;
  rules: string | null;
  last_shared_at: string | null;
};

/** The active groups an annonce belongs in: its deal, its governorate, its kind of property. */
export function groupsFor(groups: GroupRow[], l: { dealType: DealType; governorate: string; kind: string | null }): GroupRow[] {
  return groups.filter(
    (g) =>
      g.status === "active" &&
      g.deal_types.includes(l.dealType) &&
      (g.governorates.length === 0 || g.governorates.includes(l.governorate)) &&
      (g.category_kinds.length === 0 || (l.kind !== null && g.category_kinds.includes(l.kind))),
  );
}

// ── Requests ───────────────────────────────────────────────────────────────

export type CreateResult =
  | { ok: true; id: string; status: RequestStatus }
  | { ok: false; error: "disabled" | "not_found" | "forbidden" | "not_online" | "no_channel" | "consent" | "already_open" | "no_photo" | "db" };

/**
 * A seller asks for their annonce to be promoted. Refused unless it is theirs,
 * it is online, they ticked the consent, and it has no other ask open. The
 * texts are generated now, so what the admin approves is what gets posted.
 */
export async function createSocialRequest(
  admin: Admin,
  input: { userId: string; listingId: string; channels: SocialChannel[]; language: SocialLanguage; consent: boolean; origin?: string | null },
): Promise<CreateResult> {
  const settings = await socialSettings(admin);
  if (!settings.enabled) return { ok: false, error: "disabled" };
  if (!input.consent) return { ok: false, error: "consent" };
  const channels = [...new Set(input.channels)].filter((c) => OFFERED_CHANNELS.includes(c));
  if (channels.length === 0) return { ok: false, error: "no_channel" };

  const row = await loadSocialListing(admin, input.listingId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.seller_id !== input.userId) return { ok: false, error: "forbidden" };
  if (row.status !== "published") return { ok: false, error: "not_online" };
  if (channels.includes("instagram") && row.photos.length === 0) return { ok: false, error: "no_photo" };

  const { data: open } = await admin
    .from("social_publication_requests")
    .select("id")
    .eq("listing_id", row.id)
    .in("status", OPEN_REQUEST_STATUSES as string[])
    .limit(1);
  if (open && open.length > 0) return { ok: false, error: "already_open" };

  const { data: created, error } = await admin
    .from("social_publication_requests")
    .insert({
      listing_id: row.id,
      user_id: input.userId,
      channels,
      language: input.language,
      status: "pending_approval",
      consent_at: new Date().toISOString(),
      consent_version: CONSENT_VERSION,
      price_tnd: settings.priceTnd,
    })
    .select("id, ref")
    .single();
  if (error || !created) return { ok: false, error: error?.code === "23505" ? "already_open" : "db" };

  const variants = buildVariants({
    row,
    channels,
    language: input.language,
    origin: socialOrigin(input.origin),
    ref: created.ref as string,
    today: tunisToday(),
  });
  const { error: vErr } = await admin
    .from("social_content_variants")
    .insert(variants.map((v) => ({ ...v, request_id: created.id })));
  if (vErr) {
    await admin.from("social_publication_requests").delete().eq("id", created.id);
    return { ok: false, error: "db" };
  }

  if (settings.autoApprove) {
    const approved = await approveSocialRequest(admin, created.id as string, null);
    if (approved.ok) return { ok: true, id: created.id as string, status: "scheduled" };
  }

  await admin
    .rpc("_notify_admins", {
      p_kind: "admin_social_pending",
      p_title: "Promotion à valider",
      p_body: `« ${row.title} » — à publier sur les réseaux.`,
      p_link: "/admin/social",
      p_payload: { vars: { title: row.title } },
    })
    .then(() => {}, () => {});
  return { ok: true, id: created.id as string, status: "pending_approval" };
}

type AccountRow = { id: string; platform: string; status: string; token_expires_at: string | null };

/** The connected account per platform, if any (expired ones do not count). */
export async function connectedAccounts(admin: Admin): Promise<Partial<Record<"facebook_page" | "instagram", AccountRow>>> {
  const { data } = await admin
    .from("social_accounts")
    .select("id, platform, status, token_expires_at")
    .eq("status", "connected")
    .order("connected_at", { ascending: false });
  const out: Partial<Record<"facebook_page" | "instagram", AccountRow>> = {};
  const now = Date.now();
  for (const a of (data ?? []) as AccountRow[]) {
    if (a.token_expires_at && new Date(a.token_expires_at).getTime() <= now) continue;
    if ((a.platform === "facebook_page" || a.platform === "instagram") && !out[a.platform]) out[a.platform] = a;
  }
  return out;
}

/**
 * The admin approves: one job per channel. The page and Instagram go to the
 * engine when their account is connected, and to a person otherwise; each
 * Facebook group that fits the annonce gets its own manual job. Safe to call
 * twice — the jobs' unique key keeps a second call from adding any.
 */
export async function approveSocialRequest(
  admin: Admin,
  requestId: string,
  adminId: string | null,
  scheduledFor?: Date | null,
): Promise<{ ok: true; jobs: number } | { ok: false; error: "not_found" | "not_pending" | "not_online" | "db" }> {
  const { data: req } = await admin
    .from("social_publication_requests")
    .select("id, listing_id, channels, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, error: "not_found" };
  if (req.status !== "pending_approval") return { ok: false, error: "not_pending" };
  const row = await loadSocialListing(admin, req.listing_id as string);
  if (!row || row.status !== "published") return { ok: false, error: "not_online" };

  const accounts = await connectedAccounts(admin);
  const runAfter = scheduledFor && scheduledFor.getTime() > Date.now() ? scheduledFor.toISOString() : dueNow();
  const jobs: Record<string, unknown>[] = [];
  for (const channel of req.channels as SocialChannel[]) {
    if (channel === "facebook_page" || channel === "instagram") {
      const account = accounts[channel];
      jobs.push({
        request_id: requestId,
        channel,
        action: "publish",
        account_id: account?.id ?? null,
        status: account ? "scheduled" : "manual_action_required",
        manual_reason: account ? null : "no_account",
        run_after: runAfter,
      });
    } else if (channel === "facebook_groups") {
      const { data: groups } = await admin.from("social_group_directory").select("*").eq("status", "active");
      const fit = groupsFor((groups ?? []) as GroupRow[], {
        dealType: asDealType(row.deal_type),
        governorate: row.listing.governorate,
        kind: row.kind,
      });
      // No group fits yet: one task, so the ask is not lost while the directory grows.
      const targets = fit.length ? fit.map((g) => g.id) : [null];
      for (const groupId of targets) {
        jobs.push({
          request_id: requestId,
          channel,
          group_id: groupId,
          action: "publish",
          status: "manual_action_required",
          manual_reason: "groups_manual",
          run_after: runAfter,
        });
      }
    }
  }

  if (jobs.length) {
    const { error } = await admin
      .from("social_publication_jobs")
      .upsert(jobs, { onConflict: "request_id,channel,group_id,action", ignoreDuplicates: true });
    if (error) return { ok: false, error: "db" };
  }
  await admin
    .from("social_publication_requests")
    .update({
      status: "scheduled",
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      scheduled_for: scheduledFor ? scheduledFor.toISOString() : null,
    })
    .eq("id", requestId)
    .eq("status", "pending_approval");
  return { ok: true, jobs: jobs.length };
}

export async function rejectSocialRequest(
  admin: Admin,
  requestId: string,
  adminId: string,
  reason: string,
): Promise<{ ok: boolean }> {
  const { data: req } = await admin
    .from("social_publication_requests")
    .update({ status: "rejected", reviewed_by: adminId, reviewed_at: new Date().toISOString(), rejection_reason: reason })
    .eq("id", requestId)
    .eq("status", "pending_approval")
    .select("id, user_id, listing_id, listing:listings (title)")
    .maybeSingle();
  if (!req) return { ok: false };
  const listing = (Array.isArray(req.listing) ? req.listing[0] : req.listing) as { title: string } | null;
  await admin
    .rpc("enqueue_notification", {
      p_user_id: req.user_id,
      p_kind: "social_rejected",
      p_title: "Promotion non retenue",
      p_body: `La promotion de « ${listing?.title ?? ""} » n'a pas été retenue : ${reason}`,
      p_link: `/account/listings/${req.listing_id}/promote`,
      p_payload: { vars: { title: listing?.title ?? "", reason } },
    })
    .then(() => {}, () => {});
  return { ok: true };
}

/** Bring the request's status in line with its jobs. */
export async function refreshRequestStatus(admin: Admin, requestId: string): Promise<RequestStatus | null> {
  const [{ data: req }, { data: jobs }] = await Promise.all([
    admin.from("social_publication_requests").select("status").eq("id", requestId).maybeSingle(),
    admin.from("social_publication_jobs").select("status, action").eq("request_id", requestId),
  ]);
  if (!req) return null;
  const current = req.status as RequestStatus;
  // A refused, cancelled or withdrawn ask stays so, whatever its jobs say.
  if (current === "rejected" || current === "cancelled" || current === "withdrawn" || current === "pending_approval") {
    return current;
  }
  const next = requestStatusFrom((jobs ?? []) as { status: JobStatus; action: JobAction }[], current);
  if (next !== current) {
    await admin.from("social_publication_requests").update({ status: next }).eq("id", requestId);
  }
  return next;
}

/**
 * The seller cancels before anything is posted, or withdraws after: the
 * page post is taken down by the engine, the rest becomes a task.
 */
export async function withdrawSocialRequest(
  admin: Admin,
  requestId: string,
  userId: string,
): Promise<{ ok: true; status: RequestStatus } | { ok: false; error: "not_found" | "closed" }> {
  const { data: req } = await admin
    .from("social_publication_requests")
    .select("id, user_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!req || req.user_id !== userId) return { ok: false, error: "not_found" };
  const status = req.status as RequestStatus;
  if (status === "draft" || status === "pending_approval") {
    await admin.from("social_publication_requests").update({ status: "cancelled" }).eq("id", requestId);
    return { ok: true, status: "cancelled" };
  }
  if (status !== "scheduled" && status !== "published" && status !== "failed") return { ok: false, error: "closed" };

  await admin
    .from("social_publication_jobs")
    .update({ status: "cancelled", last_error: "withdrawn_by_seller" })
    .eq("request_id", requestId)
    .eq("action", "publish")
    .in("status", ["scheduled", "manual_action_required", "failed"]);

  const { data: posted } = await admin
    .from("social_publication_jobs")
    .select("channel, group_id, account_id")
    .eq("request_id", requestId)
    .eq("action", "publish")
    .eq("status", "published");
  const removals = ((posted ?? []) as { channel: SocialChannel; group_id: string | null; account_id: string | null }[]).map((j) => {
    const api = j.channel === "facebook_page" && j.account_id;
    return {
      request_id: requestId,
      channel: j.channel,
      group_id: j.group_id,
      action: "remove",
      account_id: j.account_id,
      status: api ? "scheduled" : "manual_action_required",
      manual_reason: api ? null : j.channel === "facebook_groups" ? "groups_manual" : "not_supported",
    };
  });
  if (removals.length) {
    await admin
      .from("social_publication_jobs")
      .upsert(removals, { onConflict: "request_id,channel,group_id,action", ignoreDuplicates: true });
  }
  await admin
    .from("social_publication_requests")
    .update({ status: "withdrawn", closed_at: new Date().toISOString() })
    .eq("id", requestId);
  return { ok: true, status: "withdrawn" };
}
