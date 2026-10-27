import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { checkSocialAccount } from "@/lib/social/engine";

/**
 * POST /api/admin/social/accounts/:id/test — does the stored token still
 * work? Read-only calls to Meta (the page's name, Instagram's 24 h quota);
 * nothing is posted.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "social");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;

  const r = await checkSocialAccount(admin, id);
  logAction(req, gate.user, "social.account_test", { id, ok: r.ok });
  if (!r.ok) {
    const t = await apiTranslator(req, "adminSocial.errors");
    const key = r.error === "expired" ? "testExpired" : r.error === "no_key" ? "testNoKey" : "testFailed";
    return NextResponse.json({ error: "conflict", detail: t(key) }, { status: 409 });
  }
  return NextResponse.json({ ok: true, name: r.name, quota: r.quota });
}
