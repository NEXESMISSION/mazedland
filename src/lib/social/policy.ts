/**
 * What the engine does after a failed attempt. Pure, so every branch is
 * tested without Meta: the classified error (meta.ts) and the job's attempts
 * in, the job's next state out.
 *
 *   transient / network   retry with growing waits: 1, 5, 15, 60 min…
 *   rate_limit            wait an hour; past the attempts, a person decides
 *   auth                  stop, mark the account expired, ask to reconnect
 *   media                 stop: a person changes the photos or posts by hand
 *   expired_container     make a new Instagram container now
 *   duplicate             look for the post and take it as the result
 *   permanent             stop and tell the admins
 *
 * Every stop notifies the admins; the seller only hears about a post that is
 * online (or a request that was refused).
 */
import type { GraphErrorKind } from "./meta";
import type { JobStatus } from "./channels";

export const RETRY_MINUTES = [1, 5, 15, 60, 180];

export type NextStep = {
  status: Extract<JobStatus, "scheduled" | "failed" | "manual_action_required">;
  runAfter?: Date;
  manualReason?: "account_expired" | "limit_reached" | "media_rejected";
  /** The account's token no longer works. */
  expireAccount?: boolean;
  /** Forget the Instagram container and make a new one. */
  clearContainer?: boolean;
  /** Look for the post online before anything else. */
  adopt?: boolean;
  notifyAdmins: boolean;
};

export function afterError(
  kind: GraphErrorKind,
  job: { attempts: number; max_attempts: number },
  now: Date = new Date(),
): NextStep {
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const exhausted = job.attempts >= job.max_attempts;

  switch (kind) {
    case "auth":
      return { status: "manual_action_required", manualReason: "account_expired", expireAccount: true, notifyAdmins: true };
    case "media":
      return { status: "manual_action_required", manualReason: "media_rejected", notifyAdmins: true };
    case "rate_limit":
      return exhausted
        ? { status: "manual_action_required", manualReason: "limit_reached", notifyAdmins: true }
        : { status: "scheduled", runAfter: later(60), notifyAdmins: false };
    case "expired_container":
      return exhausted
        ? { status: "failed", notifyAdmins: true }
        : { status: "scheduled", runAfter: now, clearContainer: true, notifyAdmins: false };
    case "duplicate":
      return { status: "scheduled", runAfter: now, adopt: true, notifyAdmins: false };
    case "transient":
    case "network": {
      if (exhausted) return { status: "failed", notifyAdmins: true };
      const wait = RETRY_MINUTES[Math.min(Math.max(job.attempts - 1, 0), RETRY_MINUTES.length - 1)];
      return { status: "scheduled", runAfter: later(wait), notifyAdmins: false };
    }
    default:
      return { status: "failed", notifyAdmins: true };
  }
}

/**
 * Instagram accepts photos between 4:5 (portrait) and 1.91:1 (landscape).
 * The centred crop that brings a photo inside that range, or null when it is
 * already inside. Centred because the watermark is in the middle (watermark.ts).
 */
export function instagramCrop(width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const ratio = width / height;
  if (ratio < 0.8) {
    const h = Math.round(width / 0.8);
    return { left: 0, top: Math.floor((height - h) / 2), width, height: h };
  }
  if (ratio > 1.91) {
    const w = Math.round(height * 1.91);
    return { left: Math.floor((width - w) / 2), top: 0, width: w, height };
  }
  return null;
}
