import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * Bulk delete for the admin queue inspector. Accepts the same filter
 * shape as the list endpoint and wipes every matching notification in
 * one transaction. Two modes:
 *
 *   - `{ ids: [...] }`        — explicit selection (used by "delete
 *                               selected" once we add checkboxes)
 *   - `{ filters: {...} }`    — "delete everything matching" used by
 *                               the "Supprimer tout (filtré)" button
 *
 * Both honour the admin-only RLS policy (`notifications_admin_delete`,
 * migration 0033) and the route-level role check below.
 */
export async function POST(req: NextRequest) {
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

  const body = (await req.json().catch(() => ({}))) as {
    ids?: string[];
    filters?: {
      kind?: string;
      user_id?: string;
      broadcast?: string;
      created_by?: string;
      unread?: boolean;
      q?: string;
      since?: string;
    };
  };

  let del = supabase.from("notifications").delete();

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const ids = body.ids
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .slice(0, 2000);
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids_required" }, { status: 400 });
    }
    del = del.in("id", ids);
  } else if (body.filters && typeof body.filters === "object") {
    const f = body.filters;
    if (f.kind) del = del.eq("kind", String(f.kind));
    if (f.user_id) del = del.eq("user_id", String(f.user_id));
    if (f.broadcast) del = del.eq("broadcast_id", String(f.broadcast));
    if (f.created_by) del = del.eq("created_by", String(f.created_by));
    if (f.unread) del = del.is("read_at", null);
    if (f.q) del = del.ilike("title", `%${String(f.q)}%`);
    if (f.since) del = del.gte("created_at", String(f.since));
    // Empty-filter guard: refuse a no-op-equivalent "delete everything
    // ever" call. The admin can still do it by passing a far-back
    // `since` value, which forces them to be explicit.
    const isEmpty =
      !f.kind && !f.user_id && !f.broadcast && !f.created_by && !f.unread && !f.q && !f.since;
    if (isEmpty) {
      return NextResponse.json({ error: "filters_required" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  console.log(
    `[api/admin/notifications/bulk-delete] admin=${user.id.slice(0, 8)}  body=${JSON.stringify(body).slice(0, 300)}`,
  );

  const { data, error } = await del.select("id");
  if (error) {
    console.error("[api/admin/notifications/bulk-delete] supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const deletedCount = data?.length ?? 0;
  console.log(
    `[api/admin/notifications/bulk-delete] admin=${user.id.slice(0, 8)}  deletedCount=${deletedCount}`,
  );
  return NextResponse.json({ ok: true, deletedCount });
}
