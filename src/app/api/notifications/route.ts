import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * GET /api/notifications?unread=1&limit=20
 *
 * Returns the caller's recent notifications. `unread=1` filters to
 * read_at IS NULL (for the bell badge count). Default limit is 20
 * which is enough for the dropdown — older entries are accessible
 * via the dedicated /account/notifications page (TODO).
 *
 * RLS already restricts SELECT to `auth.uid() = user_id`, so we just
 * read from the table and let policy do the filtering.
 */
export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [], unreadCount: 0 });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20), 1), 50);

  let query = supabase
    .from("notifications")
    .select("id, kind, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) query = query.is("read_at", null);

  const [{ data }, countRes] = await Promise.all([
    query,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  return NextResponse.json({
    items: data ?? [],
    unreadCount: countRes.count ?? 0,
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
    update = update.in("id", body.ids as string[]);
  } else if (body.all !== true) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { error } = await update;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
