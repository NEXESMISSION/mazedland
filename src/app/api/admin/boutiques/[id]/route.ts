import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { activePlan } from "@/lib/pro/shops";

/**
 * POST /api/admin/boutiques/:id — the console's decisions on a shop (0173).
 *   approve | reject (reason) | suspend (reason) | reinstate
 *   verify | unverify — separate from opening it: « vérifié » means an admin
 *   checked who they are, and paying never sets it.
 *
 * Each decision starts from a known status, tested in the same statement as
 * the write. A second click, or a second moderator, used to go through again:
 * the review date was overwritten and the owner was told twice. And
 * `reinstate` reopens a suspended agence only — it was a second door for a
 * pending one that had not paid its plan, which only `approve` checks.
 */
const FROM: Record<string, readonly string[]> = {
  approve: ["pending", "rejected"],
  reject: ["pending"],
  suspend: ["approved"],
  reinstate: ["suspended"],
};

/** The code and the sentence for a decision the shop's status does not allow. */
function refusal(action: string, status: string): { error: string; key: string } {
  if (status === "approved" && (action === "approve" || action === "reinstate")) return { error: "already_approved", key: "alreadyOpen" };
  if (status === "rejected" && action === "reject") return { error: "already_rejected", key: "alreadyRejected" };
  if (status === "suspended" && action === "suspend") return { error: "already_suspended", key: "alreadySuspended" };
  if (action === "reinstate") return { error: "wrong_status", key: "reinstateOnlySuspended" };
  return { error: "wrong_status", key: "wrongStatus" };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "agences");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const t = await apiTranslator(req, "proApi");

  const body = (await jsonObject(req)) as { action?: unknown; reason?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const { data: shop } = await admin.from("shops").select("id, owner_id, name, status").eq("id", id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const now = new Date().toISOString();
  const by = gate.user.id;

  // Own keys only: { action: "constructor" } used to reach a prototype function.
  const from = Object.prototype.hasOwnProperty.call(FROM, action) ? FROM[action] : undefined;
  if (from && !from.includes(shop.status)) {
    const why = refusal(action, shop.status);
    return NextResponse.json({ error: why.error, detail: t(`errors.${why.key}`) }, { status: 409 });
  }

  let update: Record<string, unknown>;
  let notice: { kind: string; title: string; body: string; vars: Record<string, string> } | null = null;
  switch (action) {
    case "approve":
      // A pending agence pays its plan before the console opens it (the
      // owner's rule, 2026-10-28): with no running plan there is nothing to
      // open, and the button used to open it anyway.
      if (!(await activePlan(admin, id))) {
        return NextResponse.json({ error: "plan_required", detail: t("errors.planRequired") }, { status: 409 });
      }
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

  let write = admin.from("shops").update(update).eq("id", id);
  if (from) write = write.in("status", [...from]);
  const { data: moved, error } = await write.select("id");
  if (error) return fail("shop_review_failed", 500, error);
  // Moved between the read above and the write: nothing was written, and the
  // owner — told by whoever got there first — is not told again.
  if (from && (moved ?? []).length === 0) {
    return NextResponse.json({ error: "wrong_status", detail: t("errors.wrongStatus") }, { status: 409 });
  }
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
