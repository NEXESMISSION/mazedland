import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/export — « Télécharger mes données »: everything Mazed Immo
 * keeps about the caller, as one JSON file (droit d'accès, loi 2004-63).
 *
 * Read with the service role, every query filtered on the caller's id. Only
 * what is theirs: their annonces, the visits they asked (not the people who
 * asked to visit theirs), what they paid. Internal moderation columns (admin
 * notes, review flags, search index) stay out; they are not personal data of
 * the caller but the console's work.
 */
const ACTIVITY_LIMIT = 500;

export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const id = user.id;

  const [
    profile, listings, requests, visits, watchlist, payments, invoices, consents,
    shops, memberships, notifications, reveals, reports, social, credits, activity,
  ] = await Promise.all([
    admin.from("profiles")
      .select("full_name, phone, governorate, language, is_diaspora, sms_notifications_enabled, created_at, updated_at")
      .eq("id", id).maybeSingle(),
    admin.from("listings")
      .select("reference, title, description, deal_type, category_id, price, negotiable, price_on_request, governorate, delegation, address, lat, lng, attributes, contact_name, contact_phone, contact_whatsapp, show_phone, status, published_at, expires_at, view_count, contact_reveal_count, created_at, updated_at")
      .eq("seller_id", id).order("created_at"),
    admin.from("property_requests")
      .select("deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min, furnished, move_in_by, note, status, alerts, expires_at, created_at")
      .eq("user_id", id).order("created_at"),
    admin.from("visit_requests")
      .select("listing_id, slots, buyer_name, buyer_phone, message, status, confirmed_slot, created_at")
      .eq("buyer_id", id).order("created_at"),
    admin.from("watchlist").select("listing_id, created_at").eq("user_id", id).order("created_at"),
    admin.from("payments")
      .select("kind, provider, provider_ref, amount, currency, status, created_at, updated_at")
      .eq("user_id", id).order("created_at"),
    admin.from("invoices")
      .select("number, doc_type, issued_at, label, amount_ht, vat_rate, vat_amount, amount_ttc, client")
      .eq("user_id", id).order("issued_at"),
    admin.from("user_consents").select("kind, granted, version, source, created_at").eq("user_id", id).order("created_at"),
    admin.from("shops")
      .select("slug, name, kind, description, governorate, city, phone, email, website, legal_name, legal_id, status, created_at")
      .eq("owner_id", id).order("created_at"),
    admin.from("shop_members").select("shop_id, role, created_at").eq("user_id", id),
    admin.from("notifications").select("kind, title, body, link, read_at, created_at").eq("user_id", id).order("created_at"),
    admin.from("contact_reveals").select("listing_id, created_at").eq("user_id", id).order("created_at"),
    admin.from("listing_reports").select("listing_id, reason, note, created_at, resolved_at").eq("reporter_id", id).order("created_at"),
    admin.from("social_publication_requests")
      .select("ref, listing_id, channels, language, status, consent_at, consent_version, created_at")
      .eq("user_id", id).order("created_at"),
    admin.from("seller_credits").select("product_id, quota_total, quota_used, expires_at, status, created_at").eq("seller_id", id),
    admin.from("activity_log")
      .select("created_at, type, action, path, ip, user_agent")
      .eq("user_id", id).order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const file = {
    exported_at: new Date().toISOString(),
    account: { id, phone: user.phone || (profile.data?.phone ?? null), ...(profile.data ?? {}) },
    listings: listings.data ?? [],
    property_requests: requests.data ?? [],
    visit_requests: visits.data ?? [],
    favourites: watchlist.data ?? [],
    payments: payments.data ?? [],
    invoices: invoices.data ?? [],
    consents: consents.data ?? [],
    shops_owned: shops.data ?? [],
    shop_memberships: memberships.data ?? [],
    notifications: notifications.data ?? [],
    phone_numbers_revealed: reveals.data ?? [],
    reports_sent: reports.data ?? [],
    social_publication_requests: social.data ?? [],
    credits: credits.data ?? [],
    activity: { latest: ACTIVITY_LIMIT, rows: activity.data ?? [] },
  };

  logAction(req, { id, email: user.email }, "account.exported", {});
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mazed-mes-donnees-${today}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
