import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";

/**
 * POST /api/admin/boutiques/:id — the console's decisions on a shop (0173).
 *   approve | reject (reason) | suspend (reason) | reinstate
 *   verify | unverify — separate from opening it: « vérifié » means an admin
 *   checked who they are, and paying never sets it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const t = await apiTranslator(req, "proApi");

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const { data: shop } = await admin.from("shops").select("id, owner_id, name, status").eq("id", id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const now = new Date().toISOString();
  const by = gate.user.id;

  let update: Record<string, unknown>;
  let notice: { kind: string; title: string; body: string; vars: Record<string, string> } | null = null;
  switch (action) {
    case "approve":
      update = { status: "approved", rejection_reason: null, reviewed_by: by, reviewed_at: now };
      notice = { kind: "shop_approved", title: "Boutique ouverte", body: `« ${shop.name} » est ouverte sur Mazed Immo.`, vars: { name: shop.name } };
      break;
    case "reject":
    case "suspend":
      if (reason.length < 3) return NextResponse.json({ error: "reason_required", detail: t("errors.reason") }, { status: 400 });
      update = { status: action === "reject" ? "rejected" : "suspended", rejection_reason: reason, reviewed_by: by, reviewed_at: now };
      notice = {
        kind: "shop_rejected",
        title: action === "reject" ? "Boutique non retenue" : "Boutique suspendue",
        body: `« ${shop.name} » : ${reason}`,
        vars: { name: shop.name, reason, variant: action === "reject" ? "rejected" : "suspended" },
      };
      break;
    case "reinstate":
      update = { status: "approved", rejection_reason: null, reviewed_by: by, reviewed_at: now };
      break;
    case "verify":
      update = { verified_at: now, verified_by: by };
      break;
    case "unverify":
      update = { verified_at: null, verified_by: null };
      break;
    default:
      return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { error } = await admin.from("shops").update(update).eq("id", id);
  if (error) return fail("shop_review_failed", 500, error);
  if (notice) {
    await admin
      .rpc("enqueue_notification", {
        p_user_id: shop.owner_id,
        p_kind: notice.kind,
        p_title: notice.title,
        p_body: notice.body,
        p_link: "/pro/dashboard",
        p_payload: { vars: notice.vars },
      })
      .then(() => {}, () => {});
  }
  logAction(req, gate.user, `admin.shop.${action}`, { id });
  return NextResponse.json({ ok: true });
}
