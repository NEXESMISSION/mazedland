/**
 * The publishing engine: takes due jobs from the queue (claim_social_jobs,
 * 0170) and does them — post, say « vendu », take down — on the Facebook
 * page and Instagram.
 *
 * Never twice. A job can be taken again after a timeout or a dead run, so
 * before posting on any attempt after the first, the engine looks for a post
 * carrying the request's reference (« MZ-1A2B3C ») and adopts it if it is
 * there. On Instagram the container is stored the moment it is made, and a
 * retry publishes that container instead of making another.
 *
 * Never without the rules. A job runs only while its request is approved and
 * its annonce online; otherwise it is cancelled. Each account posts at most
 * `social_daily_limit` times a day.
 *
 * Every attempt leaves a row in social_publication_results.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import type { JobAction, JobStatus, SocialChannel, SocialLanguage } from "./channels";
import { closedNotice, referenceCode } from "./content";
import { openToken } from "./crypto";
import {
  createIgContainer, deletePagePost, editPagePost, findIgMedia, findPagePost, graphClient, GraphError,
  igContainerStatus, igPermalink, igPublishingLimit, publishIgContainer, publishPagePost,
  type Fetch, type GraphClient, type PostedRef,
} from "./meta";
import { afterError } from "./policy";
import { refreshRequestStatus, socialOrigin, socialSettings } from "./server";
import { asDealType } from "@/lib/listings/deal";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;
const sLog = log.scope("social");

export type JobRow = {
  id: string;
  request_id: string;
  channel: SocialChannel;
  group_id: string | null;
  action: JobAction;
  account_id: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  container_id: string | null;
  external_post_id: string | null;
};

export type EngineDeps = {
  fetch?: Fetch;
  /** The site's address, for the photo URLs Meta downloads. */
  origin?: string | null;
  /** How long to wait between two looks at an Instagram container. */
  pollMs?: number;
};

type Outcome = "published" | "done" | "adopted" | "retry" | "failed" | "manual" | "cancelled";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function logResult(
  admin: Admin,
  job: JobRow,
  outcome: Exclude<Outcome, "cancelled">,
  extra: { postId?: string | null; url?: string | null; code?: string | null; message?: string | null; detail?: Record<string, unknown> } = {},
) {
  await admin.from("social_publication_results").insert({
    job_id: job.id,
    attempt: job.attempts,
    outcome,
    external_post_id: extra.postId ?? null,
    external_url: extra.url ?? null,
    error_code: extra.code ?? null,
    error_message: extra.message?.slice(0, 2000) ?? null,
    detail: extra.detail ?? {},
  });
}

async function notifyAdmins(admin: Admin, title: string, body: string) {
  await admin
    .rpc("_notify_admins", {
      p_kind: "admin_social_attention",
      p_title: title,
      p_body: body,
      p_link: "/admin/social?tab=file",
      p_payload: { vars: { title: body } },
    })
    .then(() => {}, () => {});
}

/** The job is done: store where the post is, log it, tell the seller on a first publication. */
async function succeed(admin: Admin, job: JobRow, ref: PostedRef | null, outcome: "published" | "done" | "adopted") {
  const status: JobStatus = job.action === "publish" ? "published" : "done";
  await admin
    .from("social_publication_jobs")
    .update({
      status,
      external_post_id: ref?.id ?? job.external_post_id,
      external_url: ref?.url ?? null,
      published_at: job.action === "publish" ? new Date().toISOString() : undefined,
      last_error: null,
      locked_at: null,
      manual_reason: null,
    })
    .eq("id", job.id);
  await logResult(admin, job, outcome, { postId: ref?.id, url: ref?.url });
  if (job.action !== "publish") return;

  const before = await admin.from("social_publication_requests").select("status, user_id, listing_id").eq("id", job.request_id).maybeSingle();
  await refreshRequestStatus(admin, job.request_id);
  // The seller hears once: when the first channel goes online.
  if (before.data && before.data.status !== "published") {
    await admin
      .rpc("enqueue_notification", {
        p_user_id: before.data.user_id,
        p_kind: "social_published",
        p_title: "Votre annonce est sur les réseaux",
        p_body: "Votre annonce a été publiée sur les réseaux de Mazed Immo.",
        p_link: `/account/listings/${before.data.listing_id}/promote`,
        p_payload: { vars: { channel: job.channel } },
      })
      .then(() => {}, () => {});
  }
}

async function cancel(admin: Admin, job: JobRow, why: string) {
  await admin.from("social_publication_jobs").update({ status: "cancelled", last_error: why, locked_at: null }).eq("id", job.id);
  await refreshRequestStatus(admin, job.request_id);
}

/** Hand the job to a person, with the reason the console shows. */
async function toManual(admin: Admin, job: JobRow, reason: string, message: string) {
  await admin
    .from("social_publication_jobs")
    .update({ status: "manual_action_required", manual_reason: reason, last_error: message, locked_at: null })
    .eq("id", job.id);
  await logResult(admin, job, "manual", { code: reason, message });
  await refreshRequestStatus(admin, job.request_id);
}

/** Put the job back in the queue without spending an attempt (not ready yet, quota). */
async function later(admin: Admin, job: JobRow, minutes: number, why: string) {
  await admin
    .from("social_publication_jobs")
    .update({
      status: "scheduled",
      run_after: new Date(Date.now() + minutes * 60_000).toISOString(),
      attempts: Math.max(0, job.attempts - 1),
      last_error: why,
      locked_at: null,
    })
    .eq("id", job.id);
}

async function postedToday(admin: Admin, accountId: string): Promise<number> {
  const { count } = await admin
    .from("social_publication_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("action", "publish")
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 86_400_000).toISOString());
  return count ?? 0;
}

/**
 * The account's id on the network and a client with its token. Instagram
 * posts with its Facebook page's token.
 */
async function clientFor(
  admin: Admin,
  accountId: string,
  deps: EngineDeps,
): Promise<{ g: GraphClient; externalId: string } | { error: "missing" | "expired" | "no_key" }> {
  const { data: acc } = await admin
    .from("social_accounts")
    .select("id, external_id, status, token_sealed, token_expires_at, parent_account_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) return { error: "missing" };
  if (acc.status !== "connected" || (acc.token_expires_at && new Date(acc.token_expires_at).getTime() <= Date.now())) {
    return { error: "expired" };
  }
  let sealed = acc.token_sealed as string | null;
  if (!sealed && acc.parent_account_id) {
    const { data: parent } = await admin
      .from("social_accounts")
      .select("token_sealed, status")
      .eq("id", acc.parent_account_id)
      .maybeSingle();
    if (parent?.status !== "connected") return { error: "expired" };
    sealed = (parent?.token_sealed as string | null) ?? null;
  }
  if (!sealed) return { error: "expired" };
  let token: string;
  try {
    token = openToken(sealed);
  } catch {
    return { error: "no_key" };
  }
  return {
    g: graphClient(token, { appSecret: process.env.META_APP_SECRET ?? null, fetch: deps.fetch }),
    externalId: acc.external_id as string,
  };
}

/** Do one claimed job. Never throws: every outcome ends in the job's row. */
export async function runSocialJob(admin: Admin, job: JobRow, deps: EngineDeps = {}): Promise<Outcome> {
  try {
    return await run(admin, job, deps);
  } catch (err) {
    const kind = err instanceof GraphError ? err.kind : "network";
    const step = afterError(kind, job);
    const message = err instanceof Error ? err.message : String(err);
    sLog.warn("job attempt failed", { job: job.id, channel: job.channel, action: job.action, kind, attempt: job.attempts });

    if (step.expireAccount && job.account_id) {
      await admin.from("social_accounts").update({ status: "expired", last_error: message.slice(0, 500) }).eq("id", job.account_id);
    }
    if (step.status === "manual_action_required") {
      await toManual(admin, job, step.manualReason ?? "account_expired", message);
    } else {
      await admin
        .from("social_publication_jobs")
        .update({
          status: step.status,
          run_after: step.runAfter?.toISOString(),
          last_error: message.slice(0, 1000),
          locked_at: null,
          container_id: step.clearContainer ? null : undefined,
        })
        .eq("id", job.id);
      await logResult(admin, job, step.status === "failed" ? "failed" : "retry", {
        code: err instanceof GraphError ? `${err.kind}:${err.code ?? ""}:${err.subcode ?? ""}` : "error",
        message,
      });
      if (step.status === "failed") await refreshRequestStatus(admin, job.request_id);
    }
    if (step.notifyAdmins) {
      await notifyAdmins(admin, "Publication à reprendre", `${job.channel} · ${job.action} : ${message.slice(0, 160)}`);
    }
    return step.status === "failed" ? "failed" : step.status === "scheduled" ? "retry" : "manual";
  }
}

async function run(admin: Admin, job: JobRow, deps: EngineDeps): Promise<Outcome> {
  if (job.attempts > job.max_attempts) {
    await admin.from("social_publication_jobs").update({ status: "failed", locked_at: null }).eq("id", job.id);
    await logResult(admin, job, "failed", { code: "max_attempts" });
    await refreshRequestStatus(admin, job.request_id);
    return "failed";
  }
  // Groups are shared by a person; nothing for the engine to do.
  if (job.channel === "facebook_groups" || job.channel === "tiktok") {
    await toManual(admin, job, job.channel === "facebook_groups" ? "groups_manual" : "not_supported", "manual channel");
    return "manual";
  }

  const { data: req } = await admin
    .from("social_publication_requests")
    .select("id, ref, status, language, listing:listings (id, status, deal_type)")
    .eq("id", job.request_id)
    .maybeSingle();
  const listing = (Array.isArray(req?.listing) ? req?.listing[0] : req?.listing) as
    | { id: string; status: string; deal_type: string | null }
    | null
    | undefined;
  if (!req || !listing) {
    await cancel(admin, job, "request_missing");
    return "cancelled";
  }
  if (job.action === "publish" && (!["scheduled", "published", "failed"].includes(req.status as string) || listing.status !== "published")) {
    await cancel(admin, job, listing.status !== "published" ? `listing_${listing.status}` : `request_${req.status}`);
    return "cancelled";
  }

  if (!job.account_id) {
    await toManual(admin, job, "no_account", "no connected account");
    return "manual";
  }
  const client = await clientFor(admin, job.account_id, deps);
  if ("error" in client) {
    await toManual(admin, job, client.error === "missing" ? "no_account" : "account_expired", `account ${client.error}`);
    if (client.error !== "missing") {
      await notifyAdmins(admin, "Compte à reconnecter", `Le compte ${job.channel} doit être reconnecté.`);
    }
    return "manual";
  }
  const { g, externalId } = client;
  const marker = referenceCode(req.ref as string);

  // Follow-ups work on the post the publish job made.
  if (job.action !== "publish") {
    const { data: original } = await admin
      .from("social_publication_jobs")
      .select("external_post_id")
      .eq("request_id", job.request_id)
      .eq("channel", job.channel)
      .eq("action", "publish")
      .is("group_id", null)
      .maybeSingle();
    const postId = original?.external_post_id as string | null | undefined;
    if (!postId || job.channel !== "facebook_page") {
      await succeed(admin, job, null, "done");
      return "done";
    }
    if (job.action === "remove") {
      try {
        await deletePagePost(g, postId);
      } catch (err) {
        // Already gone is what we wanted.
        if (!(err instanceof GraphError && err.code === 100)) throw err;
      }
    } else {
      const { data: v } = await admin
        .from("social_content_variants")
        .select("body")
        .eq("request_id", job.request_id)
        .eq("channel", job.channel)
        .maybeSingle();
      const notice = closedNotice(asDealType(listing.deal_type), req.language as SocialLanguage);
      await editPagePost(g, postId, `${notice}\n\n${(v?.body as string | undefined) ?? ""}`.trim());
    }
    await succeed(admin, job, { id: postId, url: null }, "done");
    return "done";
  }

  // Already online after an attempt whose outcome was unknown? Take it.
  if (job.attempts > 1 && !job.container_id) {
    const found = job.channel === "facebook_page" ? await findPagePost(g, externalId, marker) : await findIgMedia(g, externalId, marker);
    if (found) {
      await succeed(admin, job, found, "adopted");
      return "adopted";
    }
  }

  const settings = await socialSettings(admin);
  if ((await postedToday(admin, job.account_id)) >= settings.dailyLimit) {
    await later(admin, job, 60, "daily_limit");
    return "retry";
  }

  const { data: variant } = await admin
    .from("social_content_variants")
    .select("body, photo_paths")
    .eq("request_id", job.request_id)
    .eq("channel", job.channel)
    .maybeSingle();
  if (!variant) {
    await cancel(admin, job, "no_variant");
    return "cancelled";
  }
  const origin = socialOrigin(deps.origin);
  const imageUrls = ((variant.photo_paths as string[]) ?? []).map(
    (_, i) => `${origin}/api/social/image/${job.request_id}/${i}?c=${job.channel}`,
  );

  if (job.channel === "facebook_page") {
    const posted = await publishPagePost(g, externalId, { message: variant.body as string, imageUrls });
    await succeed(admin, job, posted, "published");
    return "published";
  }

  // Instagram: one container, stored at once, published when ready.
  const quota = await igPublishingLimit(g, externalId);
  if (quota && quota.used >= quota.total) {
    await later(admin, job, 60, "instagram_quota");
    return "retry";
  }
  let containerId = job.container_id;
  if (containerId) {
    const status = await igContainerStatus(g, containerId);
    if (status === "PUBLISHED") {
      const found = await findIgMedia(g, externalId, marker);
      await succeed(admin, job, found, "adopted");
      return "adopted";
    }
    if (status === "EXPIRED" || status === "ERROR") containerId = null;
  }
  if (!containerId) {
    containerId = await createIgContainer(g, externalId, { caption: variant.body as string, imageUrls });
    await admin.from("social_publication_jobs").update({ container_id: containerId }).eq("id", job.id);
    job.container_id = containerId;
  }
  for (let i = 0; i < 5; i++) {
    const status = await igContainerStatus(g, containerId);
    if (status === "FINISHED") {
      const posted = await publishIgContainer(g, externalId, containerId);
      await succeed(admin, job, { id: posted.id, url: posted.url ?? (await igPermalink(g, posted.id)) }, "published");
      return "published";
    }
    if (status === "ERROR") throw new GraphError("Instagram could not process the photos", "media");
    if (status === "EXPIRED") throw new GraphError("Instagram container expired", "expired_container");
    await sleep(deps.pollMs ?? 3000);
  }
  await later(admin, job, 2, "container_in_progress");
  return "retry";
}

/** One run of the worker: take up to `limit` due jobs and do them, one at a time. */
export async function runDueSocialJobs(admin: Admin, opts: EngineDeps & { limit?: number } = {}) {
  const { data, error } = await admin.rpc("claim_social_jobs", { p_limit: opts.limit ?? 5 });
  if (error) throw error;
  const counts: Record<Outcome, number> = { published: 0, done: 0, adopted: 0, retry: 0, failed: 0, manual: 0, cancelled: 0 };
  for (const job of (data ?? []) as JobRow[]) {
    counts[await runSocialJob(admin, job, opts)] += 1;
  }
  return { claimed: (data ?? []).length, ...counts };
}
