import { NextRequest, NextResponse } from "next/server";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { paymentsClosed } from "@/lib/payments/server";

/**
 * POST /api/pro/shops/:id/subscribe  { plan: "pro-starter" | "pro-pro" | "pro-business" }
 *
 * The owner chooses a plan; this creates the payment (kind « subscription »,
 * the plan's price read here, never from the browser) and the browser goes to
 * the usual checkout to send the receipt. The period opens when an admin
 * accepts the receipt (/api/admin/paiements). A shop must be approved first:
 * nobody pays for a shop that may not open.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "subscribe" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  // No payee to pay yet: no payment either (src/lib/payments/server.ts).
  const closed = await paymentsClosed();
  if (closed) return closed;
  const t = await apiTranslator(req, "proApi");

  const body = (await req.json().catch(() => ({}))) as { plan?: unknown };
  const slug = typeof body.plan === "string" ? body.plan : "";
  const { data: shop } = await admin.from("shops").select("status, name").eq("id", id).maybeSingle();
  if (shop?.status !== "approved") return NextResponse.json({ error: "conflict", detail: t("errors.notApproved") }, { status: 409 });

  const { data: plan } = await admin
    .from("products")
    .select("id, slug, price, duration_days, listing_quota, name_fr")
    .eq("slug", slug)
    .eq("kind", "subscription")
    .eq("is_active", true)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "invalid", detail: t("errors.plan") }, { status: 400 });

  // The same plan already waiting for a receipt: reuse it, never two.
  const { data: existing } = await admin
    .from("payments")
    .select("id")
    .eq("user_id", user.id)
    .eq("kind", "subscription")
    .in("status", ["pending", "pending_review"])
    .contains("metadata", { shop_id: id, product_id: plan.id })
    .limit(1);
  if (existing && existing.length > 0) return NextResponse.json({ ok: true, paymentId: existing[0].id });

  const { data: created, error } = await admin
    .from("payments")
    .insert({
      user_id: user.id,
      kind: "subscription",
      provider: "bank_transfer",
      amount: plan.price,
      status: "pending",
      metadata: {
        shop_id: id,
        product_id: plan.id,
        product_slug: plan.slug,
        duration_days: plan.duration_days,
        listing_quota: plan.listing_quota,
        initiated_at: new Date().toISOString(),
      },
    })
    .select("id")
    .single();
  if (error || !created) return fail("payment_create_failed", 500, error);
  logAction(req, user, "shop.subscribe", { id, plan: plan.slug, paymentId: created.id });
  return NextResponse.json({ ok: true, paymentId: created.id });
}
