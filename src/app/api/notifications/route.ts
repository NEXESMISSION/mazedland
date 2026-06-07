import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * GET /api/notifications?unread=1&limit=20
 *
 * Returns the caller's recent notifications. `unread=1` filters to
 * read_at IS NULL (for the bell badge count). Default limit is 20.
 *
 * Important: we explicitly filter `user_id = caller` because the
 * `notifications_admin_read` RLS policy (migration 0033) lets admins
 * SELECT every notification system-wide. Without this filter, an
 * admin's bell would surface other users' notifications — and the
 * DELETE route (which scopes to user_id = caller) then matched 0 rows,
 * which read as "stuff doesn't get removed" in the bell.
 *
 * The cross-user view belongs to the admin queue at
 * /admin/notifications, not the personal bell.
 */
export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], unreadCount: 0 });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 50);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  let query = supabase
    .from("notifications")
    .select("id, kind, title, body, link, payload, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (unreadOnly) query = query.is("read_at", null);

  const [{ data }, countRes] = await Promise.all([
    query,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  const items = data ?? [];
  return NextResponse.json({
    items,
    unreadCount: countRes.count ?? 0,
    // The client uses this to decide whether to keep loading more on scroll.
    hasMore: items.length === limit,
  });
}

/**
 * PATCH /api/notifications
 *   Body: { ids?: string[], all?: true }
 *
 * Mark specified notifications as read (or all unread for the caller
 * if `all: true`). RLS enforces ownership — the UPDATE policy
 * (`notifications_self_mark_read`) caps the WHERE to auth.uid().
 */
export async function PATCH(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();

  let update = supabase
    .from("notifications")
    .update({ read_at: now })
    .is("read_at", null);

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    // Validate + cap the client-supplied id list (matches the DELETE sibling):
    // no unbounded / non-string IN() payloads.
    const ids = (body.ids as unknown[])
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .slice(0, 500);
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids_required" }, { status: 400 });
    }
    update = update.in("id", ids);
  } else if (body.all !== true) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { error } = await update;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/notifications
 *   Body: { ids?: string[], all?: true }
 *
 * Permanently remove notifications. The `notifications_self_delete` RLS
 * policy (migration 0034) caps the WHERE to auth.uid() = user_id, so a
 * client trying to delete someone else's row gets a silent zero-row
 * effect rather than data leakage.
 *
 * Background cron (`prune_read_notifications`) handles the long-tail
 * cleanup of read-and-old rows so the user only has to delete things
 * they actively want gone.
 */
export async function DELETE(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  let del = supabase
    .from("notifications")
    .delete()
    .eq("user_id", user.id);

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const ids = (body.ids as string[])
      .filter((x) => typeof x === "string" && x.length > 0)
      .slice(0, 500);
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids_required" }, { status: 400 });
    }
    del = del.in("id", ids);
  } else if (body.all !== true) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // .select("id") returns the deleted rows so the client knows whether
  // its optimistic update was actually persisted. RLS-filtered DELETEs
  // can silently match 0 rows; without this, the bell can't tell a
  // successful delete from a no-op.
  const { data, error } = await del.select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deletedCount: data?.length ?? 0 });
}
