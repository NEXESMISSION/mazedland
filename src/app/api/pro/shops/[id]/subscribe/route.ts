import { NextRequest, NextResponse } from "next/server";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator, requestLocale } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { paymentsClosed } from "@/lib/payments/server";
import { getSettings } from "@/lib/settings/server";
import { quoteForShop } from "@/lib/pro/shops";
import { formatDate } from "@/lib/utils";

/**
 * POST /api/pro/shops/:id/subscribe  { plan: "pro-starter" | "pro-pro" | "pro-business" }
 *
 * The owner chooses a plan; this creates the payment (kind « subscription »,
 * the plan's price read here, never from the browser) and the browser goes to
 * the usual checkout to send the receipt. The period opens when an admin
 * accepts the receipt (/api/admin/paiements). An agence still waiting to be
 * opened chooses and pays first (the owner's rule, 2026-10-28): the admin
 * opens it on the receipt. A refused or suspended one cannot pay.
 *
 * What it costs follows the owner's rules (src/lib/pro/planChange.ts): an
 * upgrade costs the new price less what is left of the current plan; a
 * smaller plan follows the current one; the same plan is not bought again
 * while it runs, except in its last days (409 « déjà jusqu'au … »).
 *
 * One request per agence at a time: choosing a plan replaces the agence's
 * payments still waiting for a receipt (they are marked failed, like a
 * cancellation), so the console sees only the last choice — on 2026-10-28 it
 * saw a Pro 59 DT nobody meant to pay beside the Business 119 DT. Two choices
 * sent at the same moment both passed that step; the table now allows one
 * pending plan payment per payer (payments_one_pending_subscription, 0191),
 * and the second answers 409: the first one stands.
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
  if (shop?.status !== "approved" && shop?.status !== "pending") {
    return NextResponse.json({ error: "conflict", detail: t("errors.notApproved") }, { status: 409 });
  }

  const { data: plan } = await admin
    .from("products")
    .select("id, slug, price, duration_days, listing_quota, name_fr, name_ar")
    .eq("slug", slug)
    .eq("kind", "subscription")
    .eq("is_active", true)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "invalid", detail: t("errors.plan") }, { status: 400 });

  // A receipt for this plan already sent and waiting for the console: that one.
  const { data: sent } = await admin
    .from("payments")
    .select("id")
    .eq("kind", "subscription")
    .eq("status", "pending_review")
    .contains("metadata", { shop_id: id, product_id: plan.id })
    .limit(1);
  if (sent && sent.length > 0) return NextResponse.json({ ok: true, paymentId: sent[0].id });

  const settings = await getSettings();
  const now = new Date();
  const quote = await quoteForShop(admin, id, plan, settings.plan_renew_days, now);
  if (quote.kind === "same") {
    const locale = requestLocale(req);
    return NextResponse.json(
      { error: "conflict", detail: t("errors.planAlready", { date: formatDate(quote.until.toISOString(), locale, "medium"), from: formatDate(quote.renewFrom.toISOString(), locale, "medium") }) },
      { status: 409 },
    );
  }

  // The agence's earlier choices still waiting for a receipt give way to this one.
  await admin
    .from("payments")
    .update({ status: "failed", admin_notes: "Remplacé par un autre choix d'abonnement", reviewed_at: now.toISOString() })
    .eq("kind", "subscription")
    .eq("status", "pending")
    .contains("metadata", { shop_id: id });

  const { data: created, error } = await admin
    .from("payments")
    .insert({
      user_id: user.id,
      kind: "subscription",
      provider: "bank_transfer",
      amount: quote.amount,
      status: "pending",
      metadata: {
        shop_id: id,
        product_id: plan.id,
        product_slug: plan.slug,
        duration_days: plan.duration_days,
        listing_quota: plan.listing_quota,
        initiated_at: now.toISOString(),
        // How the amount was reached, frozen when it was quoted (planChange.ts).
        change: quote.kind,
        list_price: quote.price,
        // The smaller periods this one replaces and what they take off — an
        // upgrade's running plan, or a smaller plan queued behind a renewal.
        ...(quote.replaces.length > 0 ? { credit: quote.credit, credit_lines: quote.lines, replaces: quote.replaces } : {}),
        starts_at: quote.startsAt.toISOString(),
        ends_at: quote.endsAt.toISOString(),
      },
    })
    .select("id")
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: "conflict", detail: t("errors.choiceInFlight") }, { status: 409 });
  if (error || !created) return fail("payment_create_failed", 500, error);
  logAction(req, user, "shop.subscribe", { id, plan: plan.slug, paymentId: created.id, change: quote.kind, amount: quote.amount });
  return NextResponse.json({ ok: true, paymentId: created.id });
}
