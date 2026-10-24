import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { withdrawSocialRequest } from "@/lib/social/server";

/**
 * PATCH /api/social/requests/:id  { action: "withdraw" }
 *
 * The seller changes their mind. Before anything is posted the ask is simply
 * cancelled; after, the page post is taken down by the engine and what the
 * API cannot remove (Instagram, the groups) becomes a task for the team.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== "withdraw") return NextResponse.json({ error: "unknown_action" }, { status: 400 });

  const result = await withdrawSocialRequest(admin, id, user.id);
  if (!result.ok) {
    const t = await apiTranslator(req, "socialApi");
    return NextResponse.json(
      { error: result.error, detail: t(result.error === "closed" ? "closed" : "notFound") },
      { status: result.error === "closed" ? 409 : 404 },
    );
  }
  logAction(req, user, "social.withdraw", { id, status: result.status });
  return NextResponse.json({ ok: true, status: result.status });
}
