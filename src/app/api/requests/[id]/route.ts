import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { REQUEST_DAYS } from "@/lib/requests/model";

/**
 * PATCH  /api/requests/[id]  { action: "pause" | "resume" | "renew" }
 * DELETE /api/requests/[id]
 *
 * A demande's owner pauses its alerts, turns them back on, gives it another
 * REQUEST_DAYS from today, or deletes it (its matches go with it).
 */
type Action = "pause" | "resume" | "renew";

async function owned(req: NextRequest, id: string) {
  if (!isSameOrigin(req)) {
    return { res: NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 }) } as const;
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { res: NextResponse.json({ error: "auth" }, { status: 401 }) } as const;
  const admin = getServiceSupabase();
  if (!admin) return { res: fail("server_misconfigured", 500) } as const;
  const { data: row } = await admin
    .from("property_requests")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.user_id !== user.id) {
    return { res: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;
  }
  return { admin, user } as const;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const o = await owned(req, id);
  if ("res" in o) return o.res;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = body.action as Action | undefined;
  const patch =
    action === "pause"
      ? { status: "paused" }
      : action === "resume"
        ? { status: "active" }
        : action === "renew"
          ? { status: "active", expires_at: new Date(Date.now() + REQUEST_DAYS * 86_400_000).toISOString() }
          : null;
  if (!patch) return NextResponse.json({ error: "unknown_action" }, { status: 400 });

  const { error } = await o.admin.from("property_requests").update(patch).eq("id", id);
  if (error) return fail("request_update_failed", 500, error);
  logAction(req, o.user, `request.${action}`, { id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const o = await owned(req, id);
  if ("res" in o) return o.res;
  const { error } = await o.admin.from("property_requests").delete().eq("id", id);
  if (error) return fail("request_delete_failed", 500, error);
  logAction(req, o.user, "request.delete", { id });
  return NextResponse.json({ ok: true });
}
