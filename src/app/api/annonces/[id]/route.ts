import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";

/**
 * DELETE /api/annonces/:id — the seller deletes one of their drafts.
 *
 * Only a draft: it was never online, nobody holds a link to it, and nothing
 * was paid for it. An annonce that went further keeps its row (withdrawn,
 * sold, expired) — that is the record a seller or an admin comes back to.
 * Its photos go with it, from the table and from storage.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, title, photos:listing_photos (storage_path)")
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.seller_id !== user.id) return NextResponse.json({ error: "not_owner" }, { status: 403 });
  if (listing.status !== "draft") {
    const t = await apiTranslator(req, "publishApi");
    return NextResponse.json({ error: "not_a_draft", detail: t("onlyDraftDeletable") }, { status: 409 });
  }

  const paths = ((listing.photos ?? []) as { storage_path: string }[]).map((p) => p.storage_path).filter(Boolean);
  await admin.from("listing_photos").delete().eq("listing_id", id);
  // Conditional on still being a draft: a submit in another tab wins.
  const { data: gone, error } = await admin.from("listings").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return fail("listing_delete_failed", 500, error);
  if (!gone || gone.length === 0) return NextResponse.json({ error: "not_a_draft" }, { status: 409 });
  // Orphaned bytes cost little; a failed cleanup does not undo the delete.
  if (paths.length) await admin.storage.from("properties").remove(paths).then(() => {}, () => {});

  logAction(req, user, "listing.draft_delete", { id, title: listing.title });
  return NextResponse.json({ ok: true });
}
