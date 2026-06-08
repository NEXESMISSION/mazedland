import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { parseRejection } from "@/lib/rejection";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const status = body.status as "ready" | "rejected" | "pending_review" | undefined;
  const rejection_reason = body.rejection_reason ?? null;
  if (status !== "ready" && status !== "rejected" && status !== "pending_review") {
    return NextResponse.json({ error: "bad_status" }, { status: 400 });
  }

  // Fetch the property owner + title + CURRENT status before update so we can
  // notify after AND guard the transition.
  const { data: prop } = await supabase
    .from("properties")
    .select("id, owner_id, title, listing_type, status")
    .eq("id", id)
    .single();

  // Status-transition guard. Without this, the endpoint would re-process an
  // already-published/already-reviewed listing — re-firing notifications and
  // the listing-fee auto-fail logic, or resurrecting a rejected one. Only
  // allow: approve/reject from a reviewable state, restore from rejected.
  const cur = (prop?.status as string | undefined) ?? undefined;
  const reviewable = cur === "pending_review" || cur === "draft";
  const allowed =
    ((status === "ready" || status === "rejected") && reviewable) ||
    (status === "pending_review" && cur === "rejected");
  if (!allowed) {
    return NextResponse.json(
      { error: "invalid_transition", from: cur ?? null, to: status },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("properties")
    .update({
      status,
      rejection_reason: status === "rejected" ? rejection_reason : null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return fail("property_update_failed", 500, error);

  if (prop?.owner_id) {
    const admin = getServiceSupabase();
    if (admin) {
      const titleClause = prop.title ? `« ${prop.title} »` : "votre annonce";
      if (status === "ready") {
        // Auction listings still need scheduling → drop the seller on the
        // schedule form; direct sales are already live → straight to that
        // listing's detail page so the seller sees it published.
        const approvedLink =
          prop.listing_type === "direct" ? `/sell/${id}` : `/sell/${id}/schedule`;
        await admin.rpc("enqueue_notification", {
          p_user_id: prop.owner_id,
          p_kind: "listing_approved",
          p_title: "Annonce approuvée",
          p_body: `${titleClause} a été validé par l'équipe et est désormais visible.`,
          p_link: approvedLink,
        });
      } else if (status === "pending_review") {
        // Restoration (undo of a refusal). No notification — the seller
        // already got the original rejection ping; restoring quietly puts
        // the listing back in the queue. If we ever want to surface it,
        // pick a less alarming title than "Annonce refusée".
      } else if (status === "rejected") {
        const reason = (rejection_reason ?? "").toString().trim();

        // Auto-fail any pending listing-fee receipts for this property —
        // otherwise the admin queue keeps a stale receipt for a rejected
        // listing, and the seller can't easily re-submit because the
        // existing payment row blocks a fresh one. Marking them failed
        // forces a clean restart: when the seller re-submits the
        // corrected listing they upload a new receipt against a new
        // payment row.
        const { data: pendingPays } = await admin
          .from("payments")
          .select("id, user_id")
          .eq("property_id", id)
          .in("status", ["pending", "pending_review"]);

        const failNote = reason
          ? `Annonce refusée — motif : ${reason}. Soumettez à nouveau votre annonce corrigée pour générer un nouveau paiement.`
          : "Annonce refusée par l'équipe. Soumettez à nouveau votre annonce pour générer un nouveau paiement.";

        if (pendingPays && pendingPays.length > 0) {
          await admin
            .from("payments")
            .update({
              status: "failed",
              admin_notes: failNote,
              reviewer_id: user.id,
              reviewed_at: new Date().toISOString(),
            })
            .in("id", pendingPays.map((p) => p.id));
        }

        // Notification deep link carries every category so the edit
        // form ring-highlights ALL flagged sections (not just one).
        const parsed = parseRejection(reason);
        const editLink = parsed.tagged && parsed.categories.length > 0
          ? `/sell/${id}/edit?focus=${parsed.categories.join(",")}`
          : `/sell/${id}/edit`;
        await admin.rpc("enqueue_notification", {
          p_user_id: prop.owner_id,
          p_kind: "listing_rejected",
          p_title: "Annonce refusée",
          p_body: reason
            ? `Motif : ${parsed.message || reason}. Vous pouvez corriger votre annonce et la soumettre à nouveau.`
            : `${titleClause} a été refusé par l'équipe. Consultez votre tableau de bord pour les détails.`,
          p_link: editLink,
        });
      }
    }
  }

  logAction(req, user, `property.${status}`, { propertyId: id });
  return NextResponse.json({ ok: true });
}
