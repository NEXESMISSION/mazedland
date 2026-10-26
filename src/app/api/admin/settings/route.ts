import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

const TEXT_KEYS = [
  "payee_name",
  "payee_bank",
  "payee_rib",
  "payee_iban",
  "payee_d17",
  // Invoices (0175): copied into each one when it is issued.
  "company_name",
  "company_tax_id",
  "company_address",
] as const;

/**
 * PUT /api/admin/settings — admin-only. Persists the payee fields and the two
 * moderation settings (0165) into app_settings; anything off the allowlist is
 * ignored.
 *
 * It used to also write listing fees, promo prices, a bidding caution, auction
 * formats, an anti-snipe window and a final-payment delay. Nothing read any of
 * them — fees are priced by the products catalogue — so those writes are gone
 * with the form fields that sent them.
 */
export async function PUT(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const rows: { key: string; value: unknown; updated_by: string }[] = [];

  // ── Payee text ───────────────────────────────────────────────────────
  for (const key of TEXT_KEYS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (typeof raw !== "string") {
      return NextResponse.json({ error: "invalid_text", key }, { status: 400 });
    }
    rows.push({ key, value: raw.trim().slice(0, 200), updated_by: user.id });
  }

  // ── Free places and moderation (0165) ────────────────────────────────
  // Empty means « no VAT shown »; otherwise a rate in percent.
  if ("invoice_vat_rate" in body) {
    const raw = body.invoice_vat_rate;
    if (raw === "" || raw === null) {
      rows.push({ key: "invoice_vat_rate", value: "", updated_by: user.id });
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 50) {
        return NextResponse.json({ error: "invalid_number", key: "invoice_vat_rate" }, { status: 400 });
      }
      rows.push({ key: "invoice_vat_rate", value: n, updated_by: user.id });
    }
  }

  if ("free_listing_limit" in body) {
    const n = Number(body.free_listing_limit);
    if (!Number.isInteger(n) || n < 0 || n > 50) {
      return NextResponse.json({ error: "invalid_number", key: "free_listing_limit" }, { status: 400 });
    }
    rows.push({ key: "free_listing_limit", value: n, updated_by: user.id });
  }
  if ("moderation_banned_words" in body) {
    const raw = body.moderation_banned_words;
    if (!Array.isArray(raw) || raw.some((w) => typeof w !== "string")) {
      return NextResponse.json({ error: "invalid_list", key: "moderation_banned_words" }, { status: 400 });
    }
    const words = Array.from(
      new Set((raw as string[]).map((w) => w.trim().toLowerCase().slice(0, 40)).filter(Boolean)),
    ).slice(0, 200);
    rows.push({ key: "moderation_banned_words", value: words, updated_by: user.id });
  }

  if (rows.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return fail("settings_update_failed", 500, error);

  logAction(req, user, "settings.update", { keys: rows.map((r) => r.key) });
  return NextResponse.json({ ok: true, updated: rows.length });
}
