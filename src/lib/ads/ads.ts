/**
 * Advertising spaces (0177): a company's image and link, in one placement,
 * between two dates. What decides whether a banner shows, what the console
 * calls its state, and what counts as a link we will send a visitor to.
 *
 * Pure — no database, no React — so the rules are tested once and the public
 * pages, the tracking routes and the console all apply the same ones.
 */
import { intlTag } from "@/lib/utils";

/** Where a banner can go, in the order the console offers them. */
export const AD_PLACEMENTS = ["home_top", "home_middle", "catalogue", "listing"] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export function isAdPlacement(v: unknown): v is AdPlacement {
  return typeof v === "string" && (AD_PLACEMENTS as readonly string[]).includes(v);
}

/** A row of `ads`, as the console reads it. */
export type Ad = {
  id: string;
  advertiser: string;
  title: string | null;
  title_ar: string | null;
  image_path: string;
  image_mobile_path: string | null;
  link_url: string;
  placement: AdPlacement;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  sort_order: number;
  views: number;
  clicks: number;
  created_at: string;
  updated_at: string;
};

/** What a public page needs to draw a banner: never the link (it goes through
 *  the click route) and never the counts. */
export type PublicAd = Pick<
  Ad,
  "id" | "advertiser" | "title" | "title_ar" | "image_path" | "image_mobile_path" | "active" | "starts_at" | "ends_at"
>;

/** The part of an ad that says when it shows. */
export type AdTiming = Pick<Ad, "active" | "starts_at" | "ends_at">;

// ─── State ──────────────────────────────────────────────────────────────────

export const AD_STATUSES = ["live", "scheduled", "paused", "ended"] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * « En cours », « Programmée », « En pause » or « Terminée ».
 *
 * Ended wins over paused: a campaign past its last day will not come back by
 * switching it on, and « En pause » would suggest it could. A paused campaign
 * that has not started yet says paused, because that is what will stop it.
 */
export function adStatus(ad: AdTiming, now: Date): AdStatus {
  const t = now.getTime();
  const end = time(ad.ends_at);
  if (!Number.isNaN(end) && t >= end) return "ended";
  if (!ad.active) return "paused";
  const start = time(ad.starts_at);
  if (!Number.isNaN(start) && t < start) return "scheduled";
  return "live";
}

/** Shown right now: switched on, started, not yet over. `ends_at` is the first
 *  moment it no longer shows. */
export function isLive(ad: AdTiming, now: Date): boolean {
  return adStatus(ad, now) === "live";
}

// ─── The link ───────────────────────────────────────────────────────────────

const MAX_LINK = 600;

/**
 * The advertiser's link, or null when it is not one we will redirect to.
 *
 * Only http and https: the click route answers with a redirect to this
 * address, and a `javascript:` or `data:` one would turn our own domain into
 * the launch pad. An address typed without its scheme (« biat.com.tn/credit »)
 * is taken as https, so the admin does not have to type it. A user name or
 * password in the address is refused — it is how a link pretends to go to one
 * site and goes to another (`https://mazed.tn@evil.example`).
 */
export function safeAdLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_LINK || /\s/.test(s)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // A bare word (« banque ») parses as a host; nobody advertises an intranet.
  if (!url.hostname.includes(".")) return null;
  return url.href.length <= MAX_LINK ? url.href : null;
}

// ─── Numbers ────────────────────────────────────────────────────────────────

/** Clicks per view, 0–1. Null when nobody has seen it yet: 0 % would read as
 *  « nobody clicked », which is not the same thing. */
export function ctr(clicks: number, views: number): number | null {
  if (!Number.isFinite(views) || views <= 0) return null;
  const c = Number.isFinite(clicks) && clicks > 0 ? clicks : 0;
  return Math.min(1, c / views);
}

/** « 4,2 % » · « 0,35 % » · « — ». Banner rates are small, so under 1 % keeps
 *  a second decimal — 0,3 % and 0,34 % are different campaigns. */
export function formatCtr(rate: number | null, locale: string): string {
  if (rate === null) return "—";
  return new Intl.NumberFormat(intlTag(locale), {
    style: "percent",
    maximumFractionDigits: rate > 0 && rate < 0.01 ? 2 : 1,
  })
    .format(rate)
    // French puts a narrow no-break space before « % », which the site's font
    // draws a pixel wide (see readableSpaces in src/lib/utils.ts).
    .replace(/ /g, " ");
}

/** The top of a bar chart's scale: the next clean number at or above `max`
 *  (5, 10, 20, 50, 100…), so its one tick reads as a round figure. */
export function chartCeil(max: number): number {
  if (!Number.isFinite(max) || max <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(max));
  const m = max / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// ─── Images ─────────────────────────────────────────────────────────────────

/**
 * The sizes the console recommends. Wide is 4:1 — a full-width strip that
 * does not push the annonces off a desktop screen; the phone version is 2:1,
 * tall enough for a logo and a sentence to be read at 320 px.
 */
export const AD_IMAGE = {
  wide: { width: 1600, height: 400 },
  mobile: { width: 800, height: 400 },
  /** A banner is a picture and a few words: 3 MB is already generous. */
  maxBytes: 3 * 1024 * 1024,
} as const;

export const AD_IMAGE_EXTS = ["jpg", "png", "webp"] as const;
export type AdImageExt = (typeof AD_IMAGE_EXTS)[number];

/** The extension we store a file under, from its name or its type. */
export function adImageExt(nameOrType: string): AdImageExt | null {
  const s = nameOrType.toLowerCase().trim();
  const ext = s.includes("/") ? s.split("/").pop()! : s.split(".").pop()!;
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png" || ext === "webp") return ext;
  return null;
}

/** `ads/<uuid>.<ext>` — the only paths the console mints, and the only ones
 *  an ad may point at. */
export function isAdImagePath(v: unknown): v is string {
  return typeof v === "string" && /^ads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(v);
}

/** What the image says, for a screen reader: the title in the page's
 *  language, the other one, then the advertiser's name. */
export function adAlt(ad: Pick<Ad, "advertiser" | "title" | "title_ar">, locale: string): string {
  const own = locale === "ar" ? ad.title_ar : ad.title;
  const other = locale === "ar" ? ad.title : ad.title_ar;
  return own?.trim() || other?.trim() || ad.advertiser;
}
