/**
 * Editing an annonce that is already online (0172, 0176).
 *
 * Any change to an annonce an admin let online takes it offline until an
 * admin approves the change (the owner's rule, 2026-10-26): on a property
 * site, the difference between a price correction and a bait-and-switch is a
 * person reading it. The new version waits in `pending_edit`; the annonce
 * moves to `pending_review` with the approved version still in its columns.
 * An admin publishes the edit, or refuses it — and the approved version goes
 * back online as it was. The seller may withdraw the edit, with the same
 * effect. The database refuses any other way in (0176).
 *
 * The rules still run on the edit, to tell the admin what changed for the
 * worse: a flag the live version already carried (too few photos on the
 * imported catalogue, a seller not yet trusted) was accepted when it went
 * online; a new one — a phone number typed into the description, an
 * implausible price, a duplicate — is the reason to look closely.
 *
 * Approved, an edit keeps the annonce's publication date and expiry:
 * correcting the price does not buy thirty more days. One that expired while
 * the edit waited comes back with fresh dates, as a republication would.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { LISTING_COLUMNS, moderationSettings, publishOrQueue, reviewFlagsFor, type ListingRow } from "@/lib/moderation/server";
import { publishListing } from "./publish";
import type { ReviewFlag } from "@/lib/moderation/rules";
import { notifyMatchingRequests } from "@/lib/requests/server";
import type { PhotoRow } from "./input";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export type ListingEdit = { fields: Record<string, unknown>; photos: PhotoRow[] | null };
export type PendingEdit = ListingEdit & { flags: ReviewFlag[]; submittedAt: string };

/**
 * Whether the seller may correct this annonce now: online, or waiting for an
 * admin — but not one taken offline after visitors' reports, which an admin
 * judges as it was reported.
 */
export function isEditable(l: { status: string; review_flags?: readonly string[] | null }): boolean {
  if (l.status === "published") return true;
  return l.status === "pending_review" && !(l.review_flags ?? []).includes("reported");
}

/** What the new version trips that the live one did not. */
export function newFlags(before: readonly ReviewFlag[], after: readonly ReviewFlag[]): ReviewFlag[] {
  return after.filter((f) => !before.includes(f));
}

/** Read back a stored pending edit, or null when it is not one. */
export function asPendingEdit(v: unknown): PendingEdit | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!o.fields || typeof o.fields !== "object") return null;
  return {
    fields: o.fields as Record<string, unknown>,
    photos: Array.isArray(o.photos) ? (o.photos as PhotoRow[]) : null,
    flags: Array.isArray(o.flags) ? (o.flags as ReviewFlag[]) : [],
    submittedAt: typeof o.submittedAt === "string" ? o.submittedAt : "",
  };
}

/** The changed fields, for the console's before/after. Photos compare by path and order. */
export function changedKeys(current: Record<string, unknown>, edit: ListingEdit, currentPhotos: string[]): string[] {
  const keys = Object.keys(edit.fields).filter(
    (k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(edit.fields[k] ?? null),
  );
  if (edit.photos && JSON.stringify(edit.photos.map((p) => p.storage_path)) !== JSON.stringify(currentPhotos)) {
    keys.push("photos");
  }
  return keys;
}

/** Where an edit can be: on an annonce online (from before 0176), or held offline for it. */
const EDITED = ["published", "pending_review"];

/**
 * An admin approved the edit: write it over the annonce and put it back
 * online. Its dates stay; one that expired while the edit waited is published
 * again with fresh dates (and the seller hears « en ligne » from that path).
 */
export async function applyEdit(
  admin: Admin,
  listingId: string,
  edit: ListingEdit,
  reviewerId: string | null = null,
): Promise<{ ok: true; republished: boolean } | { ok: false; error?: unknown }> {
  const { data: cur, error: readErr } = await admin
    .from("listings")
    .select("seller_id, title, fee_payment_id, expires_at")
    .eq("id", listingId)
    .in("status", EDITED)
    .maybeSingle();
  if (readErr || !cur) return { ok: false, error: readErr ?? new Error("listing_not_editable") };

  const now = new Date();
  const { error } = await admin
    .from("listings")
    .update({
      ...edit.fields,
      pending_edit: null,
      pending_edit_at: null,
      status: "published",
      ...(reviewerId ? { reviewed_by: reviewerId, reviewed_at: now.toISOString() } : {}),
    })
    .eq("id", listingId)
    .in("status", EDITED);
  if (error) return { ok: false, error };

  if (edit.photos) {
    await admin.from("listing_photos").delete().eq("listing_id", listingId);
    if (edit.photos.length > 0) {
      const { error: pErr } = await admin
        .from("listing_photos")
        .insert(edit.photos.map((p) => ({ ...p, listing_id: listingId })));
      if (pErr) return { ok: false, error: pErr };
    }
  }

  const expired = !!cur.expires_at && new Date(cur.expires_at as string).getTime() <= now.getTime();
  if (expired) {
    const out = await publishListing(
      admin,
      {
        id: listingId,
        seller_id: cur.seller_id as string,
        title: typeof edit.fields.title === "string" ? edit.fields.title : (cur.title as string),
        fee_payment_id: (cur.fee_payment_id as string | null) ?? null,
      },
      { reviewerId },
    );
    if (!out.ok) return { ok: false, error: out.error };
  } else {
    // A lower price or a new surface can answer demandes it did not before.
    await notifyMatchingRequests(admin, listingId).catch(() => 0);
  }

  // Posted on Mazed Immo's pages? The post still says what the annonce said.
  const { data: posted } = await admin
    .from("social_publication_jobs")
    .select("id, request:social_publication_requests!inner (listing_id)")
    .eq("request.listing_id", listingId)
    .eq("action", "publish")
    .eq("status", "published")
    .limit(1);
  if (posted && posted.length > 0) {
    const { data: l } = await admin.from("listings").select("title").eq("id", listingId).maybeSingle();
    await admin
      .rpc("_notify_admins", {
        p_kind: "admin_social_attention",
        p_title: "Annonce modifiée après publication",
        p_body: `« ${l?.title ?? ""} » a changé : vérifiez ses publications sur les réseaux.`,
        p_link: "/admin/social?tab=publies",
        p_payload: { vars: { title: `« ${l?.title ?? ""} » a changé : vérifiez ses publications sur les réseaux.` } },
      })
      .then(() => {}, () => {});
  }
  return { ok: true, republished: expired };
}

/**
 * The seller's edit of a published annonce, or a newer version of an edit
 * already waiting: held for an admin, and the annonce offline until then.
 * What the edit trips that the approved version did not is kept as the
 * reason for the admin.
 */
export async function proposeEdit(
  admin: Admin,
  listingId: string,
  edit: ListingEdit,
): Promise<{ status: "pending"; flags: ReviewFlag[] } | { status: "error"; error: unknown }> {
  const { data, error } = await admin
    .from("listings")
    .select(`${LISTING_COLUMNS}, status, pending_edit_at`)
    .eq("id", listingId)
    .maybeSingle();
  if (error || !data) return { status: "error", error: error ?? new Error("listing_not_found") };
  const current = data as unknown as ListingRow & { status: string; pending_edit_at: string | null };
  // A second version of an edit already waiting replaces it; nothing else
  // than an annonce online can be edited this way.
  const replacing = current.status === "pending_review" && current.pending_edit_at != null;
  if (current.status !== "published" && !replacing) return { status: "error", error: new Error("listing_not_live") };

  const settings = await moderationSettings(admin);
  const candidate = { ...current, ...edit.fields } as ListingRow;
  const [before, after] = await Promise.all([
    reviewFlagsFor(admin, current, settings),
    reviewFlagsFor(admin, candidate, settings, edit.photos ? { photoCount: edit.photos.length } : {}),
  ]);
  const flags = newFlags(before, after);

  const pending: PendingEdit = { ...edit, flags, submittedAt: new Date().toISOString() };
  // Offline from here: the catalogue only shows `published`. Conditional on
  // the status read above, so a moderation decision in between is not undone.
  const { data: held, error: upErr } = await admin
    .from("listings")
    .update({ pending_edit: pending, pending_edit_at: pending.submittedAt, status: "pending_review" })
    .eq("id", listingId)
    .eq("status", current.status)
    .select("id");
  if (upErr) return { status: "error", error: upErr };
  if (!held || held.length === 0) return { status: "error", error: new Error("listing_changed") };

  // Once per edit: a newer version of one already waiting is in the same row.
  if (replacing) return { status: "pending", flags };
  await admin
    .rpc("_notify_admins", {
      p_kind: "admin_listing_edit_pending",
      p_title: "Modification à vérifier",
      p_body: `« ${current.title} » — le vendeur a modifié son annonce : elle est hors ligne jusqu'à votre validation.`,
      p_link: `/admin/annonces?status=edits&a=${listingId}`,
      p_payload: { vars: { title: current.title } },
    })
    .then(() => {}, () => {});
  return { status: "pending", flags };
}

/**
 * The edit is gone — an admin refused it, or the seller withdrew it — and the
 * approved version is what the annonce shows: back online, or expired if its
 * time ran out while the edit waited. `sellerId` limits it to their annonce.
 */
export async function dropEdit(
  admin: Admin,
  listingId: string,
  opts: { sellerId?: string } = {},
): Promise<{ ok: true; status: string } | { ok: false; error?: unknown }> {
  let read = admin.from("listings").select("status, expires_at").eq("id", listingId).not("pending_edit", "is", null);
  if (opts.sellerId) read = read.eq("seller_id", opts.sellerId);
  const { data: cur, error: readErr } = await read.maybeSingle();
  if (readErr || !cur) return { ok: false, error: readErr ?? new Error("no_pending_edit") };

  const status =
    cur.status !== "pending_review"
      ? (cur.status as string)
      : cur.expires_at && new Date(cur.expires_at as string).getTime() > Date.now()
        ? "published"
        : "expired";
  const { data, error } = await admin
    .from("listings")
    .update({ pending_edit: null, pending_edit_at: null, status })
    .eq("id", listingId)
    .eq("status", cur.status as string)
    .not("pending_edit", "is", null)
    .select("id");
  if (error) return { ok: false, error };
  if (!data || data.length === 0) return { ok: false, error: new Error("listing_changed") };
  return { ok: true, status };
}

/**
 * A correction to an annonce still waiting for an admin (pending_review). It is
 * not online, so there is nothing to protect: the seller's new version — the
 * price with one zero fewer, a better photo — is written straight into it, and
 * the moderation decision runs again. Clean now, it goes online at once;
 * otherwise it keeps waiting, with the reasons as they now stand.
 *
 * Never one held after reports (see isEditable): rewriting it would drop the
 * `reported` flag with the rest, and a second edit could put it back online.
 */
export async function editWaiting(
  admin: Admin,
  listingId: string,
  edit: ListingEdit,
): Promise<{ status: "published" } | { status: "pending_review"; flags: ReviewFlag[] } | { status: "error"; error: unknown }> {
  const { data: moved, error } = await admin
    .from("listings")
    .update({ ...edit.fields, pending_edit: null, pending_edit_at: null })
    .eq("id", listingId)
    .eq("status", "pending_review")
    .not("review_flags", "cs", "{reported}")
    // Not one held for an edit: its columns are the approved version.
    .is("pending_edit", null)
    .select("id");
  if (error) return { status: "error", error };
  if (!moved || moved.length === 0) return { status: "error", error: new Error("listing_not_waiting") };
  if (edit.photos) {
    await admin.from("listing_photos").delete().eq("listing_id", listingId);
    if (edit.photos.length > 0) {
      const { error: pErr } = await admin.from("listing_photos").insert(edit.photos.map((p) => ({ ...p, listing_id: listingId })));
      if (pErr) return { status: "error", error: pErr };
    }
  }
  const out = await publishOrQueue(admin, listingId, await moderationSettings(admin));
  if (out.status === "error") return out;
  return out.status === "published" ? { status: "published" } : { status: "pending_review", flags: out.flags };
}
