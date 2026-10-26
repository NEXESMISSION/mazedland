/**
 * The channels an annonce can be promoted on, and what each one can do.
 *
 *   facebook_page    Mazed Immo's Facebook page — posted by the API.
 *   instagram        Mazed Immo's Instagram account — posted by the API.
 *   facebook_groups  Tunisian property groups — Meta closed the groups API in
 *                    2024, so the text is prepared here and a person on the
 *                    team shares it by hand, group by group.
 *   tiktok           Later (phase 3): an app that has not passed TikTok's audit
 *                    can only post privately, which is no promotion at all.
 *
 * The values are stored in the database (0170) and must not be translated.
 */
export const SOCIAL_CHANNELS = ["facebook_page", "instagram", "facebook_groups", "tiktok"] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

/** What a seller can choose today. */
export const OFFERED_CHANNELS: readonly SocialChannel[] = ["facebook_page", "instagram", "facebook_groups"];

/** Posted by the engine when an account is connected; by hand otherwise. */
export const API_CHANNELS: readonly SocialChannel[] = ["facebook_page", "instagram"];

export const SOCIAL_LANGUAGES = ["both", "ar", "fr"] as const;
export type SocialLanguage = (typeof SOCIAL_LANGUAGES)[number];

export function isSocialChannel(v: unknown): v is SocialChannel {
  return typeof v === "string" && (SOCIAL_CHANNELS as readonly string[]).includes(v);
}

export function isSocialLanguage(v: unknown): v is SocialLanguage {
  return typeof v === "string" && (SOCIAL_LANGUAGES as readonly string[]).includes(v);
}

/** The account platform a channel posts through, if any. */
export function platformOf(channel: SocialChannel): "facebook_page" | "instagram" | "tiktok" | null {
  if (channel === "facebook_groups") return null;
  return channel;
}

/** Instagram takes 10 photos in a carousel; a Facebook post shows 4 well. */
export const MAX_PHOTOS: Record<SocialChannel, number> = {
  facebook_page: 4,
  instagram: 10,
  facebook_groups: 4,
  tiktok: 10,
};

/** `utm_source` per channel — what the tracking reads back. */
export const UTM_SOURCE: Record<SocialChannel, string> = {
  facebook_page: "facebook",
  instagram: "instagram",
  facebook_groups: "facebook_group",
  tiktok: "tiktok",
};

export function channelFromUtmSource(source: string | null | undefined): SocialChannel | "other" {
  const hit = (Object.entries(UTM_SOURCE) as [SocialChannel, string][]).find(([, s]) => s === source);
  return hit ? hit[0] : "other";
}

/**
 * The statuses of an ask (0170), as the seller and the console show them.
 * `manual_action_required` belongs to a job, not to the ask.
 */
export const REQUEST_STATUSES = [
  "draft", "pending_approval", "scheduled", "published", "failed", "rejected", "cancelled", "withdrawn",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const JOB_STATUSES = [
  "scheduled", "running", "published", "done", "failed", "manual_action_required", "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobAction = "publish" | "mark_closed" | "remove";

/** An ask that still blocks a second one for the same annonce (see the 0170 index). */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = [
  "draft", "pending_approval", "scheduled", "published", "failed",
];

/**
 * The ask's status from its publish jobs: online as soon as one channel is,
 * still on its way while any channel is, failed only when every one failed.
 * Cancelled jobs do not count; an ask with none left keeps its status.
 */
export function requestStatusFrom(
  jobs: { status: JobStatus; action: JobAction }[],
  current: RequestStatus,
): RequestStatus {
  const live = jobs.filter((j) => j.action === "publish" && j.status !== "cancelled");
  if (live.length === 0) return current;
  if (live.some((j) => j.status === "published")) return "published";
  if (live.some((j) => j.status === "scheduled" || j.status === "running" || j.status === "manual_action_required")) {
    return "scheduled";
  }
  return "failed";
}
