import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { MAX_ACTIVE_REQUESTS, parseRequestInput } from "@/lib/requests/model";

/**
 * POST /api/requests — create or update a demande (0168).
 *
 *   { id?, deal_type, category_ids[], governorates[], budget_min?, budget_max,
 *     surface_min?, rooms_min?, furnished?, move_in_by?, note?, alerts? }
 *
 * The owner is always the caller. Categories are kept only if they exist and
 * are leaves, like an annonce's. A person keeps at most MAX_ACTIVE_REQUESTS
 * live demandes: past that, alerts stop meaning "this is what I want".
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
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
  if ((count ?? 0) >= MAX_ACTIVE_REQUESTS) {
    const t = await apiTranslator(req, "requestsApi");
    return NextResponse.json(
      { error: "too_many", detail: t("tooMany", { max: MAX_ACTIVE_REQUESTS }) },
      { status: 409 },
    );
  }

  const { data: created, error } = await admin
    .from("property_requests")
    .insert({ ...value, user_id: user.id })
    .select("id")
    .single();
  if (error || !created) return fail("request_create_failed", 500, error);
  logAction(req, user, "request.create", { id: created.id, deal: value.deal_type });
  return NextResponse.json({ ok: true, id: created.id });
}
