/**
 * What the console may write into `ads`, checked field by field.
 *
 * The table checks most of this too (0177), but a CHECK violation comes back
 * as a redacted 500; catching it here gives the admin the field and the
 * reason. The dates arrive as days (`starts_on`, `ends_on`, both included)
 * and leave as the instants the table stores (src/lib/ads/dates.ts).
 *
 * `partial` is the PATCH: only the fields sent are read, so « Mettre en
 * pause » can send `{ active: false }` without blanking the rest. The two
 * dates go together — sending one clears the other.
 */
import { isAdImagePath, isAdPlacement, safeAdLink, type Ad } from "./ads";
import { campaignWindow } from "./dates";

export type AdWrite = Partial<
  Pick<
    Ad,
    | "advertiser"
    | "title"
    | "title_ar"
    | "image_path"
    | "image_mobile_path"
    | "link_url"
    | "placement"
    | "starts_at"
    | "ends_at"
    | "active"
    | "sort_order"
  >
>;

/** The field that is wrong — each has a sentence in `adminAds.api`. */
export type AdInputError = "advertiser" | "title" | "image" | "imageMobile" | "link" | "placement" | "dates" | "active";

export type AdInputResult = { ok: true; value: AdWrite } | { ok: false; error: AdInputError };

const MAX_SORT = 9999;

/** Trimmed text, `null` for empty, `undefined` for too long or not text. */
function text(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  return s.length <= max ? s : undefined;
}

export function parseAdInput(body: Record<string, unknown>, { partial }: { partial: boolean }): AdInputResult {
  const out: AdWrite = {};
  const has = (k: string) => !partial || k in body;

  if (has("advertiser")) {
    const v = text(body.advertiser, 120);
    if (!v) return { ok: false, error: "advertiser" };
    out.advertiser = v;
  }
  for (const [key, field] of [["title", "title"], ["title_ar", "title_ar"]] as const) {
    if (!has(key)) continue;
    const v = text(body[key], 160);
    if (v === undefined) return { ok: false, error: "title" };
    out[field] = v;
  }
  if (has("image_path")) {
    if (!isAdImagePath(body.image_path)) return { ok: false, error: "image" };
    out.image_path = body.image_path;
  }
  if (has("image_mobile_path")) {
    const v = body.image_mobile_path;
    if (v === null || v === undefined || v === "") out.image_mobile_path = null;
    else if (isAdImagePath(v)) out.image_mobile_path = v;
    else return { ok: false, error: "imageMobile" };
  }
  if (has("link_url")) {
    const link = safeAdLink(body.link_url);
    if (!link) return { ok: false, error: "link" };
    out.link_url = link;
  }
  if (has("placement")) {
    if (!isAdPlacement(body.placement)) return { ok: false, error: "placement" };
    out.placement = body.placement;
  }
  if (has("starts_on") || has("ends_on")) {
    const day = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const win = campaignWindow(day(body.starts_on), day(body.ends_on));
    if (!win) return { ok: false, error: "dates" };
    out.starts_at = win.starts_at;
    out.ends_at = win.ends_at;
  }
  // Only a boolean: anything else (« "false" », 0, null) used to switch the ad ON.
  if (has("active")) {
    // Left out of a full form: on, as before. Sent as anything but a boolean
    // (« "false" », 0, null): refused — it used to switch the ad ON.
    if (body.active === undefined) {
      if (!partial) out.active = true;
    } else if (typeof body.active !== "boolean") {
      return { ok: false, error: "active" };
    } else {
      out.active = body.active;
    }
  }
  if (has("sort_order")) {
    const n = Math.floor(Number(body.sort_order));
    out.sort_order = Number.isFinite(n) ? Math.max(0, Math.min(MAX_SORT, n)) : 0;
  }
  return { ok: true, value: out };
}
