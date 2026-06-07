import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";

/**
 * Admin queue inspector — list notifications across all users with
 * filtering and pagination.
 *
 * Query params:
 *   kind        — exact match on notifications.kind
 *   user_id     — exact match on recipient
 *   broadcast   — exact match on broadcast_id
 *   created_by  — exact match on sender (admin user)
 *   unread      — "1" to only show unread
 *   q           — fuzzy match on title (ILIKE)
 *   since       — ISO timestamp lower bound on created_at
 *   limit       — page size (default 50, max 200)
 *   offset      — pagination offset
 *
 * Returns:
 *   { items, total, stats: { last24h, last7d, unreadRate } }
 *
 * RLS: relies on the `notifications_admin_read` policy in migration 0033.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { supabase } = gate;

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind")?.trim() || null;
  const userId = sp.get("user_id")?.trim() || null;
  const broadcastId = sp.get("broadcast")?.trim() || null;
  const createdBy = sp.get("created_by")?.trim() || null;
  const unread = sp.get("unread") === "1";
  const q = sp.get("q")?.trim() || null;
  const since = sp.get("since")?.trim() || null;
  const limitRaw = Number(sp.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

  // Recipient + sender profile joins so the queue row can show "à
  // Jean Dupont (individual) — envoyé par Admin Y" instead of two
  // opaque uuid slices. profiles is FK-related to notifications via
  // user_id and created_by; supabase-js infers the relation names
  // from the FK so we disambiguate with the column name.
  let query = supabase
    .from("notifications")
    .select(
      `
        id, user_id, kind, title, body, link, read_at, created_at, created_by, broadcast_id,
        recipient:profiles!notifications_user_id_fkey (full_name, role),
        sender:profiles!notifications_created_by_fkey (full_name, role)
      `,
      // `estimated`, not `exact`: notifications is the fastest-fan-out table
      // (one row per recipient per event; a broadcast = one row per user), so
      // an exact full-count scan on every admin queue load gets slower with
      // every broadcast. Approximate total is fine for a paginated admin list.
      { count: "estimated" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (kind) query = query.eq("kind", kind);
  if (userId) query = query.eq("user_id", userId);
  if (broadcastId) query = query.eq("broadcast_id", broadcastId);
  if (createdBy) query = query.eq("created_by", createdBy);
  if (unread) query = query.is("read_at", null);
  if (q) query = query.ilike("title", `%${q}%`);
  if (since) query = query.gte("created_at", since);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Stats — small parallel queries scoped to admin-visible rows. These
  // are cheap thanks to the indexes added in earlier migrations.
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: c24 }, { count: c7d }, { count: cUnread }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .gte("created_at", since7d),
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  return NextResponse.json({
    items: data ?? [],
    total: count ?? 0,
    stats: {
      last24h: c24 ?? 0,
      last7d: c7d ?? 0,
      unread: cUnread ?? 0,
    },
  });
}
