import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { parseRequestInput, requestExpiresAt } from "@/lib/requests/model";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/requests — create or update a demande (0168).
 *
 *   { id?, deal_type, category_ids[], governorates[], budget_min?, budget_max,
 *     surface_min?, rooms_min?, furnished?, move_in_by?, note?, alerts? }
 *
 * The owner is always the caller. Categories are kept only if they exist and
 * are leaves, like an annonce's. A person keeps at most `requests_max_active`
 * live demandes: past that, alerts stop meaning "this is what I want". A new
 * one lives `requests_days`. Switched off, nothing is created or edited; the
 * demandes already there can still be paused or deleted (/api/requests/:id).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const off = await featureOff("feature_requests");
  if (off) return off;
  const settings = await getSettings();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseRequestInput(body);
  if (!parsed.ok) {
    const t = await apiTranslator(req, "requestsApi");
    return NextResponse.json(
      { error: parsed.error, detail: t(parsed.error === "budget_required" ? "budgetRequired" : "budgetOrder") },
      { status: 400 },
    );
  }
  const value = parsed.value;

  if (value.category_ids.length > 0) {
    const { data: cats } = await admin
      .from("categories")
      .select("id")
      .in("id", value.category_ids)
      .eq("is_active", true)
      .not("parent_id", "is", null);
    value.category_ids = (cats ?? []).map((c) => c.id as string);
  }

  const id = typeof body.id === "string" ? body.id : null;
  if (id) {
    const { data: own } = await admin
      .from("property_requests")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();
    if (!own || own.user_id !== user.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const { error } = await admin.from("property_requests").update(value).eq("id", id);
    if (error) return fail("request_update_failed", 500, error);
    logAction(req, user, "request.update", { id });
    return NextResponse.json({ ok: true, id });
  }

  const { count } = await admin
    .from("property_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if ((count ?? 0) >= settings.requests_max_active) {
    const t = await apiTranslator(req, "requestsApi");
    return NextResponse.json(
      { error: "too_many", detail: t("tooMany", { max: settings.requests_max_active }) },
      { status: 409 },
    );
  }

  const { data: created, error } = await admin
    .from("property_requests")
    // The table's own default is 60 days; the console's length wins.
    .insert({ ...value, user_id: user.id, expires_at: requestExpiresAt(settings.requests_days) })
    .select("id")
    .single();
  if (error || !created) return fail("request_create_failed", 500, error);
  logAction(req, user, "request.create", { id: created.id, deal: value.deal_type });
  return NextResponse.json({ ok: true, id: created.id });
}
