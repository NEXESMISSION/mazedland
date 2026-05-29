/**
 * Popup domain types. Shared by the admin form, the API routes, and the
 * client-side PopupManager so all three agree on the shape.
 *
 * Localised text fields (`title`, `body`, CTA labels) store one row per
 * locale under the locale key. PopupManager picks the active locale's
 * value at render time; if the locale is missing it falls back to `fr`.
 */

export type PopupVariant = "banner" | "modal" | "sheet";
export type PopupMode = "broadcast" | "rule";
export type PopupStatus = "draft" | "live" | "paused" | "archived";
export type PopupFrequency =
  | "once_per_user"
  | "once_per_session"
  | "every_visit"
  | "every_n_days";
export type PopupDevices = "mobile" | "desktop" | "both";
export type PopupLocale = "fr" | "ar" | "en";

export type LocalisedText = Partial<Record<PopupLocale, string>>;

export type PopupCta = {
  label: LocalisedText;
  href: string;
  tone?: "primary" | "secondary" | "ghost";
};

/**
 * Audience filter. Phase-1 supports the coarse scope + optional role
 * membership + explicit user-id list. Phase-3 adds the `derived` block
 * (kyc_status, has_bid, governorate, etc.). The matcher RPC ignores
 * unknown keys, so adding fields later is backward-compatible.
 */
export type PopupAudience =
  | { scope: "all" }
  | { scope: "anon" }
  | { scope: "logged_in"; roles?: string[]; user_ids?: string[] };

export interface Popup {
  id: string;
  slug: string;
  mode: PopupMode;
  variant: PopupVariant;
  title: LocalisedText;
  body: LocalisedText;
  image_url: string | null;
  icon: string | null;
  cta_primary: PopupCta | null;
  cta_secondary: PopupCta | null;
  audience: PopupAudience;
  pages: string[];
  locales: PopupLocale[];
  devices: PopupDevices;
  starts_at: string | null;
  ends_at: string | null;
  frequency: PopupFrequency;
  frequency_n: number | null;
  dismissible: boolean;
  force_action: boolean;
  priority: number;
  status: PopupStatus;
  group_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Glob matcher reused server-side (admin preview) and client-side
 * (PopupManager). Supports trailing-`*` wildcards and a `!` prefix for
 * negations. Empty patterns array → matches every path.
 *
 *   matchPath("/", [])                                 → true
 *   matchPath("/auctions/abc", ["/auctions/*"])        → true
 *   matchPath("/admin/x",  ["/admin/*", "!/admin/lo*"])→ true unless lo*
 *   matchPath("/",         ["/auctions/*"])            → false
 */
export function matchPath(path: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  let matched = false;
  for (const raw of patterns) {
    const isNeg = raw.startsWith("!");
    const pattern = isNeg ? raw.slice(1) : raw;
    if (globMatch(path, pattern)) {
      if (isNeg) return false; // negation wins immediately
      matched = true;
    }
  }
  return matched;
}

function globMatch(path: string, pattern: string): boolean {
  if (pattern === "/") return path === "/";
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(prefix + "/");
  }
  return path === pattern;
}

/**
 * Pick the active locale's text, falling back to fr → ar → en → "".
 * Used by both the admin preview and the client renderer so we
 * don't have a "key missing" hole in the UI.
 */
export function pickLocalised(text: LocalisedText, locale: string): string {
  return (
    text[locale as PopupLocale] ??
    text.fr ??
    text.ar ??
    text.en ??
    ""
  );
}
