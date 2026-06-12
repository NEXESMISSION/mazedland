import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { cleanDurationDays } from "@/lib/pricing";
import { APP_SETTINGS_TAG } from "@/lib/settings";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

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
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

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
    const v = body[key] as { enabled?: unknown; value?: unknown; duration_days?: unknown } | undefined;
    if (!v || typeof v !== "object") continue;
    rows.push({
      key,
      value: {
        enabled: v.enabled === true,
        value: cleanValue("fixed", v.value),
        duration_days: cleanDurationDays(v.duration_days),
      },
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

  // ── Anti-snipe (auction time extension), stored in minutes ───────────
  let antiSnipeSec: { window: number; by: number } | null = null;
  {
    const v = body.auction_antisnipe as { window_min?: unknown; extend_min?: unknown } | undefined;
    if (v && typeof v === "object") {
      const clampMin = (raw: unknown) => {
        const n = Math.floor(Number(raw));
        return Number.isFinite(n) && n >= 0 ? Math.min(120, n) : 0;
      };
      const windowMin = clampMin(v.window_min);
      const extendMin = clampMin(v.extend_min);
      rows.push({
        key: "auction_antisnipe",
        value: { window_min: windowMin, extend_min: extendMin },
        updated_by: user.id,
      });
      antiSnipeSec = { window: windowMin * 60, by: extendMin * 60 };
    }
  }

  // ── Auction formats available to sellers ─────────────────────────────
  // English is always available (not stored). Only the optional extras are
  // toggled; anything missing defaults to OFF (English-only marketplace).
  {
    const v = body.auction_types as { dutch_enabled?: unknown; sealed_enabled?: unknown } | undefined;
    if (v && typeof v === "object") {
      rows.push({
        key: "auction_types",
        value: {
          dutch_enabled: v.dutch_enabled === true,
          sealed_enabled: v.sealed_enabled === true,
        },
        updated_by: user.id,
      });
    }
  }

  // ── Winner's final-payment deadline (days, 1..90) ────────────────────
  {
    const v = body.final_payment_days as { days?: unknown } | undefined;
    if (v && typeof v === "object") {
      const n = Math.round(Number(v.days));
      const days = Number.isFinite(n) && n >= 1 ? Math.min(90, n) : 14;
      rows.push({ key: "final_payment_days", value: { days }, updated_by: user.id });
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
  if (error) return fail("settings_update_failed", 500, error);

  // Bust the cached app_settings read so the new fees/deposit/anti-snipe take
  // effect immediately across the app instead of waiting out the 300s TTL.
  // Next 16 requires the cache-life profile arg; "max" fully purges the tag.
  revalidateTag(APP_SETTINGS_TAG, "max");

  // Push the anti-snipe change onto auctions that are still open, so the
  // setting governs live + scheduled lots immediately — not just ones
  // created afterwards. (New auctions also read these values at creation.)
  if (antiSnipeSec) {
    await admin
      .from("auctions")
      .update({
        extend_window_seconds: antiSnipeSec.window,
        extend_by_seconds: antiSnipeSec.by,
      })
      .in("status", ["scheduled", "live", "extending"]);
  }

  logAction(req, user, "settings.update", { keys: rows.map((r) => r.key) });
  return NextResponse.json({ ok: true, updated: rows.length });
}
