import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { approveSocialRequest, rejectSocialRequest } from "@/lib/social/server";
import { runDueSocialJobs } from "@/lib/social/engine";

/**
 * POST /api/admin/social/requests/:id
 *   { action: "approve", scheduledFor?: ISO date }   → jobs, posted at once or at that time
 *   { action: "reject", reason }                     → the seller is told why
 *
 * An approval posts right away (after the response) instead of waiting for
 * the next cron run; a scheduled one waits for its time.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "social");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown; scheduledFor?: unknown };

  if (body.action === "approve") {
    const when = typeof body.scheduledFor === "string" && body.scheduledFor ? new Date(body.scheduledFor) : null;
    if (when && Number.isNaN(when.getTime())) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const r = await approveSocialRequest(admin, id, gate.user.id, when);
    if (!r.ok) {
      return NextResponse.json({ error: r.error === "not_found" ? "not_found" : "conflict", detail: r.error }, {
        status: r.error === "not_found" ? 404 : 409,
      });
    }
    logAction(req, gate.user, "social.approve", { id, scheduledFor: when?.toISOString() ?? null });
    if (!when || when.getTime() <= Date.now()) {
      const origin = req.nextUrl.origin;
      after(() => runDueSocialJobs(admin, { limit: 5, origin }).catch(() => {}));
    }
    return NextResponse.json({ ok: true, jobs: r.jobs });
  }

  if (body.action === "reject") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (reason.length < 3) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const r = await rejectSocialRequest(admin, id, gate.user.id, reason);
    if (!r.ok) return NextResponse.json({ error: "conflict" }, { status: 409 });
    logAction(req, gate.user, "social.reject", { id });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid" }, { status: 400 });
}
