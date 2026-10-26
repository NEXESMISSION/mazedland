/**
 * Editing an annonce that is already online (0172).
 *
 * The edit is checked by the same rules as a new annonce, but only for what
 * the edit itself changes: a flag the live version already carried (too few
 * photos on the imported catalogue, a seller not yet trusted) was accepted
 * when it went online and does not hold back a price correction. A new flag —
 * a phone number typed into the description, an implausible price, a
 * duplicate of another of the seller's annonces — sends the edit to an admin,
 * and the annonce stays online as it was meanwhile.
 *
 * Applied, an edit keeps the annonce's status, publication date and expiry:
 * correcting the price does not buy thirty more days.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { LISTING_COLUMNS, moderationSettings, publishOrQueue, reviewFlagsFor, type ListingRow } from "@/lib/moderation/server";
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

/** Write the edit over the live annonce, and clear any edit waiting. */
export async function applyEdit(admin: Admin, listingId: string, edit: ListingEdit): Promise<{ ok: boolean; error?: unknown }> {
  const { error } = await admin
    .from("listings")
    .update({ ...edit.fields, pending_edit: null, pending_edit_at: null })
    .eq("id", listingId)
    .eq("status", "published");
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

  // A lower price or a new surface can answer demandes it did not before.
  await notifyMatchingRequests(admin, listingId).catch(() => 0);

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
  return { ok: true };
}

/**
 * The seller's edit of a published annonce: applied when it is clean, held
 * for an admin when it trips a rule the live version did not.
 */
export async function proposeEdit(
  admin: Admin,
  listingId: string,
  edit: ListingEdit,
): Promise<{ status: "applied" } | { status: "pending"; flags: ReviewFlag[] } | { status: "error"; error: unknown }> {
  const { data, error } = await admin.from("listings").select(`${LISTING_COLUMNS}, status`).eq("id", listingId).maybeSingle();
  if (error || !data) return { status: "error", error: error ?? new Error("listing_not_found") };
  const current = data as unknown as ListingRow & { status: string };

  const settings = await moderationSettings(admin);
  const candidate = { ...current, ...edit.fields } as ListingRow;
  const [before, after] = await Promise.all([
    reviewFlagsFor(admin, current, settings),
    reviewFlagsFor(admin, candidate, settings, edit.photos ? { photoCount: edit.photos.length } : {}),
  ]);
  const flags = newFlags(before, after);

  if (flags.length === 0) {
    const out = await applyEdit(admin, listingId, edit);
    return out.ok ? { status: "applied" } : { status: "error", error: out.error };
  }

  const pending: PendingEdit = { ...edit, flags, submittedAt: new Date().toISOString() };
  const { error: upErr } = await admin
    .from("listings")
    .update({ pending_edit: pending, pending_edit_at: pending.submittedAt })
    .eq("id", listingId);
  if (upErr) return { status: "error", error: upErr };

  await admin
    .rpc("_notify_admins", {
      p_kind: "admin_listing_edit_pending",
      p_title: "Modification à vérifier",
      p_body: `« ${current.title} » — le vendeur a modifié son annonce en ligne.`,
      p_link: `/admin/annonces?status=edits&a=${listingId}`,
      p_payload: { vars: { title: current.title } },
    })
    .then(() => {}, () => {});
  return { status: "pending", flags };
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
