import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";

const TEXT_KEYS = [
  "payee_name",
  "payee_bank",
  "payee_rib",
  "payee_iban",
  "payee_d17",
] as const;

type Mode = "free" | "fixed" | "percent";

function cleanValue(mode: Mode, raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return mode === "percent" ? Math.min(100, n) : Math.min(1_000_000, n);
}

/**
 * PUT /api/admin/settings — admin-only. Persists the structured
 * monetization config (listing fees, promos, deposit) + payee fields into
 * app_settings as jsonb. Validates modes/values; ignores anything off the
 * allowlist to keep the surface tight.
 */
export async function PUT(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const rows: { key: string; value: unknown; updated_by: string }[] = [];

  // ── Listing fees ─────────────────────────────────────────────────────
  // Auctions: free | fixed only (no price at posting time for a percent).
  function listingFee(key: string, allowPercent: boolean) {
    const v = body[key] as { mode?: unknown; value?: unknown } | undefined;
    if (!v || typeof v !== "object") return;
    let m = (["free", "fixed", "percent"] as const).includes(v.mode as Mode)
      ? (v.mode as Mode) : "fixed";
    if (m === "percent" && !allowPercent) m = "fixed";
    rows.push({ key, value: { mode: m, value: cleanValue(m, v.value) }, updated_by: user!.id });
  }
  listingFee("fee_listing_auction", false);
  listingFee("fee_listing_direct", true);

  // ── Promo add-ons ────────────────────────────────────────────────────
  for (const key of ["promo_home", "promo_top", "promo_banner"]) {
    const v = body[key] as { enabled?: unknown; value?: unknown } | undefined;
    if (!v || typeof v !== "object") continue;
    rows.push({
      key,
      value: { enabled: v.enabled === true, value: cleanValue("fixed", v.value) },
      updated_by: user.id,
    });
  }

  // ── Deposit ──────────────────────────────────────────────────────────
  {
    const v = body.deposit as { mode?: unknown; value?: unknown; free_until?: unknown } | undefined;
    if (v && typeof v === "object") {
      const m = (["free", "fixed", "percent"] as const).includes(v.mode as Mode)
        ? (v.mode as Mode) : "percent";
      let freeUntil: string | null = null;
      if (typeof v.free_until === "string" && v.free_until.trim()) {
        const d = new Date(v.free_until);
        if (!Number.isNaN(d.getTime())) freeUntil = d.toISOString();
        else return NextResponse.json({ error: "invalid_date", key: "deposit.free_until" }, { status: 400 });
      }
      rows.push({
        key: "deposit",
        value: { mode: m, value: cleanValue(m, v.value), free_until: freeUntil },
        updated_by: user.id,
      });
    }
  }

  // ── Payee text ───────────────────────────────────────────────────────
  for (const key of TEXT_KEYS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "invalid_text", key }, { status: 400 });
    }
    rows.push({ key, value: raw.trim().slice(0, 200), updated_by: user.id });
  }

  if (rows.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: rows.length });
}
