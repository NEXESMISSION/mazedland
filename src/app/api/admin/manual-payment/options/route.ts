import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { fail } from "@/lib/http/errors";

/**
 * GET /api/admin/manual-payment/options?type=user|auction&q=… — admin-only.
 * Lightweight typeahead for the manual-payment form so it doesn't depend on
 * broad browser-side RLS reads. Service-role, capped at 10 results.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  if (type === "user") {
    let query = admin
      .from("profiles")
      .select("id, full_name, phone, kyc_status")
      .order("created_at", { ascending: false })
      .limit(10);
    if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) return fail("user_search_failed", 500, error);
    return NextResponse.json({ results: data ?? [] });
  }

  if (type === "auction") {
    // Embedded-title search via inner join (same pattern as payouts/deposits).
    const sel = `id, status, winner_user_id, buy_now_price, current_price, opening_price,
      property:properties${q ? "!inner" : ""} ( title, governorate )`;
    let query = admin.from("auctions").select(sel).limit(10);
    if (q) query = query.ilike("property.title", `%${q}%`);
    // Surface the actionable lots first.
    query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) return fail("auction_search_failed", 500, error);
    type Row = {
      id: string; status: string; winner_user_id: string | null;
      buy_now_price: number | null; current_price: number | null; opening_price: number;
      property: { title: string; governorate: string | null } | { title: string; governorate: string | null }[] | null;
    };
    const results = ((data ?? []) as unknown as Row[]).map((r) => {
      const p = Array.isArray(r.property) ? r.property[0] : r.property;
      return {
        id: r.id,
        title: p?.title ?? "—",
        governorate: p?.governorate ?? null,
        status: r.status,
        winner_user_id: r.winner_user_id,
        buy_now_price: r.buy_now_price,
        current_price: r.current_price,
        opening_price: r.opening_price,
      };
    });
    return NextResponse.json({ results });
  }

  return NextResponse.json({ error: "bad_type" }, { status: 400 });
}
