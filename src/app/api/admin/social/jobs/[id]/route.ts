import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { dueNow, refreshRequestStatus } from "@/lib/social/server";
import { runSocialJob, type JobRow } from "@/lib/social/engine";

/**
 * POST /api/admin/social/jobs/:id
 *   { action: "run" }          do it now (the page or Instagram), without waiting for the cron
 *   { action: "retry" }        a failed or blocked job back in the queue, attempts reset
 *   { action: "done", url? }   a person did it by hand (a group, Instagram): record it
 *   { action: "cancel" }       drop it
 *
 * « run » claims the job the way the cron does (status running, attempt
 * counted), so a cron run at the same moment cannot take it too.
 */
const OPEN = ["scheduled", "failed", "manual_action_required"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "social");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { id } = await params;
  const body = (await jsonObject(req)) as { action?: unknown; url?: unknown };
  const { data: job } = await admin.from("social_publication_jobs").select("*").eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "run") {
    if (!["scheduled", "failed"].includes(job.status as string) || (job.channel !== "facebook_page" && job.channel !== "instagram")) {
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    }
    const { data: claimed } = await admin
      .from("social_publication_jobs")
      .update({ status: "running", locked_at: new Date().toISOString(), attempts: (job.attempts as number) + 1 })
      .eq("id", id)
      .eq("status", job.status)
      .select("*")
      .maybeSingle();
    if (!claimed) return NextResponse.json({ error: "already_claimed" }, { status: 409 });
    const outcome = await runSocialJob(admin, claimed as JobRow, { origin: req.nextUrl.origin });
    logAction(req, gate.user, "social.job_run", { id, outcome });
    return NextResponse.json({ ok: true, outcome });
  }

  if (body.action === "retry") {
    if (!OPEN.includes(job.status as string) || job.channel === "facebook_groups") {
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    }
    await admin
      .from("social_publication_jobs")
      .update({ status: "scheduled", attempts: 0, run_after: dueNow(), manual_reason: null, last_error: null })
      .eq("id", id);
    await refreshRequestStatus(admin, job.request_id as string);
    logAction(req, gate.user, "social.job_retry", { id });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "done") {
    if (!OPEN.includes(job.status as string)) return NextResponse.json({ error: "conflict" }, { status: 409 });
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (url && !/^https:\/\/([a-z0-9-]+\.)*(facebook\.com|instagram\.com|fb\.com|tiktok\.com)\//i.test(url)) {
      return NextResponse.json({ error: "invalid", detail: (await apiTranslator(req, "adminSocial.errors"))("url") }, { status: 400 });
    }
    const now = new Date().toISOString();
    await admin
      .from("social_publication_jobs")
      .update({
        status: job.action === "publish" ? "published" : "done",
        external_url: url || null,
        published_at: job.action === "publish" ? now : job.published_at,
        done_by: gate.user.id,
        locked_at: null,
      })
      .eq("id", id);
    await admin.from("social_publication_results").insert({
      job_id: id,
      attempt: job.attempts,
      outcome: "manual",
      external_url: url || null,
      actor: gate.user.id,
      detail: { by_hand: true },
    });
    if (job.group_id) {
      await admin.from("social_group_directory").update({ last_shared_at: now }).eq("id", job.group_id);
    }
    await refreshRequestStatus(admin, job.request_id as string);
    logAction(req, gate.user, "social.job_done", { id, url: url || null });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "cancel") {
    if (!OPEN.includes(job.status as string)) return NextResponse.json({ error: "conflict" }, { status: 409 });
    await admin.from("social_publication_jobs").update({ status: "cancelled", locked_at: null }).eq("id", id);
    await refreshRequestStatus(admin, job.request_id as string);
    logAction(req, gate.user, "social.job_cancel", { id });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid" }, { status: 400 });
}
