/**
 * Every setting an admin changes in /admin/settings, in one list.
 *
 * Adding a setting is one entry here plus its label and hint under
 * `settingsRegistry.<key>` in both message files. The console lists it, the
 * API checks it against this definition, and `getSettings()` hands it to the
 * code that applies it with this default when nothing is stored. Keys that
 * existed before this list (payee, company, free places, banned words, AI,
 * social) keep their names, so what was saved stays saved.
 *
 * `client: true` sends the value to every page (feature switches the browser
 * applies, limits a form enforces before sending). Never on a secret.
 */
import type { SettingDef, ValueOf } from "./define";

export const SETTINGS = {
  // ── Features: each one switched off disappears from the site and its API
  //    refuses, without touching what already exists (a visit already asked
  //    stays in « Mes visites », a placement already bought runs its course).
  feature_visits: { group: "features", type: "bool", default: true, client: true },
  feature_compare: { group: "features", type: "bool", default: true, client: true },
  feature_requests: { group: "features", type: "bool", default: true, client: true, href: "/admin/demandes" },
  feature_pro_signup: { group: "features", type: "bool", default: true, client: true, href: "/admin/agences" },
  feature_promos: { group: "features", type: "bool", default: true, client: true, href: "/admin/offres" },
  social_enabled: { group: "features", type: "bool", default: true, href: "/admin/social" },
  ai_enabled: { group: "features", type: "bool", default: true },
  feature_listing_edit: { group: "features", type: "bool", default: true, client: true, href: "/admin/annonces?status=edits" },
  feature_reports: { group: "features", type: "bool", default: true, client: true },
  feature_price_help: { group: "features", type: "bool", default: true, client: true },
  feature_watermark: { group: "features", type: "bool", default: true, client: true },
  feature_natural_search: { group: "features", type: "bool", default: true },
  // A microphone in the search boxes (P5): spoken words fill the box, then search.
  feature_voice_search: { group: "features", type: "bool", default: true, client: true },
  feature_arabic_redirect: { group: "features", type: "bool", default: true, client: true },
  feature_whatsapp: { group: "features", type: "bool", default: true, client: true },
  // Advertising spaces sold to companies (0177), managed in /admin/publicites.
  feature_ads: { group: "features", type: "bool", default: true, href: "/admin/publicites" },
  // Promoters' projects and their units (0179): the « Projets » tab and pages.
  feature_projects: { group: "features", type: "bool", default: true, client: true, href: "/admin/agences" },
  // What a period brought to an agence's annonces (0183): the « Rapports » tab.
  feature_pro_reports: { group: "features", type: "bool", default: true },
  // The admins hear of a crash in production the first time it happens (0185).
  feature_error_alerts: { group: "features", type: "bool", default: true, href: "/admin/activity?type=error" },

  // ── Home page: the rails of annonces and the ads move by themselves.
  home_rail_autoplay: { group: "home", type: "bool", default: true, client: true },
  home_rail_seconds: { group: "home", type: "int", default: 5, min: 3, max: 15, unit: "seconds", client: true },
  // How many annonces a rail holds — the limit of its query — and which rails
  // there are. A rail switched off is neither queried nor shown; one with
  // fewer than three annonces hides itself either way (src/lib/home/rails.ts).
  home_rail_size: { group: "home", type: "int", default: 12, min: 4, max: 24 },
  home_rail_featured: { group: "home", type: "bool", default: true, href: "/admin/home" },
  home_rail_most_viewed: { group: "home", type: "bool", default: true },
  home_rail_new: { group: "home", type: "bool", default: true },
  home_rail_rent: { group: "home", type: "bool", default: true },
  home_rail_deals: { group: "home", type: "bool", default: true },
  home_rail_appartements: { group: "home", type: "bool", default: true },
  home_rail_villas: { group: "home", type: "bool", default: true },
  home_rail_maisons: { group: "home", type: "bool", default: true },
  home_rail_terrain: { group: "home", type: "bool", default: true },
  home_rail_explore: { group: "home", type: "bool", default: true },
  ads_rotate_seconds: { group: "home", type: "int", default: 6, min: 3, max: 30, unit: "seconds", client: true },

  // ── Moderation: how much of the site runs by itself.
  free_listing_limit: { group: "moderation", type: "int", default: 2, min: 0, max: 50 },
  moderation_auto_publish: { group: "moderation", type: "bool", default: true },
  moderation_min_photos: { group: "moderation", type: "int", default: 3, min: 0, max: 12, unit: "photos", client: true },
  moderation_report_threshold: { group: "moderation", type: "int", default: 3, min: 1, max: 50 },
  moderation_banned_words: { group: "moderation", type: "list", default: [], maxItems: 200, maxLen: 40, lower: true },

  // ── Publication.
  listing_default_days: { group: "publication", type: "int", default: 30, min: 1, max: 365, unit: "days" },
  listing_max_photos: { group: "publication", type: "int", default: 12, min: 1, max: 30, unit: "photos", client: true },
  catalogue_page_size: { group: "publication", type: "int", default: 24, min: 12, max: 60 },
  // A project goes public only while its agence has a running plan.
  projects_need_plan: { group: "publication", type: "bool", default: true },
  projects_max_units: { group: "publication", type: "int", default: 300, min: 10, max: 2000 },
  // The same agence plan can be renewed only this many days before it ends (planChange.ts).
  plan_renew_days: { group: "publication", type: "int", default: 5, min: 1, max: 30, unit: "days", choices: [3, 5, 7, 15] },

  // ── Buyers: visits, compare, demandes.
  visits_max_slots: { group: "buyers", type: "int", default: 3, min: 1, max: 5, client: true },
  visits_horizon_days: { group: "buyers", type: "int", default: 30, min: 3, max: 90, unit: "days", client: true },
  compare_max: { group: "buyers", type: "int", default: 3, min: 2, max: 4, client: true },
  requests_max_active: { group: "buyers", type: "int", default: 10, min: 1, max: 50 },
  requests_days: { group: "buyers", type: "int", default: 60, min: 7, max: 365, unit: "days" },

  // ── How people reach Mazed Immo.
  contact_whatsapp: { group: "contact", type: "text", default: "+216 58 415 510", max: 30, ltr: true, client: true },
  contact_email: { group: "contact", type: "text", default: "contact@mazed.immo", max: 120, ltr: true },
  contact_phone: { group: "contact", type: "text", default: "", max: 30, ltr: true },

  // ── Social Publisher (0170) and the listing assistant (0169).
  social_price_tnd: { group: "social", type: "number", default: 0, min: 0, max: 1000, unit: "tnd" },
  social_auto_approve: { group: "social", type: "bool", default: false },
  social_daily_limit: { group: "social", type: "int", default: 10, min: 1, max: 100, unit: "per_day" },
  ai_daily_budget_usd: { group: "social", type: "number", default: 2, min: 0, max: 100, step: 0.5 },

  // ── Where sellers pay (manual transfer / D17). Secret: the checkout reads
  //    them on the server, for a payer with an open payment only.
  payee_name: { group: "payment", type: "text", default: "", max: 200, secret: true },
  payee_bank: { group: "payment", type: "text", default: "", max: 200, secret: true },
  payee_rib: { group: "payment", type: "text", default: "", max: 40, ltr: true, secret: true },
  payee_iban: { group: "payment", type: "text", default: "", max: 40, ltr: true, secret: true },
  payee_d17: { group: "payment", type: "text", default: "", max: 40, ltr: true, secret: true },

  // ── On every invoice (0175): copied into each one when it is issued.
  company_name: { group: "company", type: "text", default: "", max: 200 },
  company_tax_id: { group: "company", type: "text", default: "", max: 40, ltr: true },
  company_address: { group: "company", type: "text", default: "", max: 200, multiline: true },
  invoice_vat_rate: { group: "company", type: "number", default: null, min: 0, max: 50, unit: "percent", optional: true },

  // ── Abuse limits: how often one person may do a thing.
  limit_visits_per_day: { group: "limits", type: "int", default: 10, min: 1, max: 200, unit: "per_day" },
  limit_reports_per_hour: { group: "limits", type: "int", default: 10, min: 1, max: 200, unit: "per_hour" },
  limit_edits_per_hour: { group: "limits", type: "int", default: 20, min: 1, max: 200, unit: "per_hour" },
  limit_phone_reveals_per_hour: { group: "limits", type: "int", default: 40, min: 1, max: 1000, unit: "per_hour" },
  limit_suggestions_per_day: { group: "limits", type: "int", default: 30, min: 1, max: 500, unit: "per_day" },
  limit_shop_create_per_hour: { group: "limits", type: "int", default: 5, min: 1, max: 50, unit: "per_hour" },
  sms_daily_cap: { group: "limits", type: "int", default: 6, min: 0, max: 50, unit: "per_day" },
  // One alert per error per this many hours (0185 reads it with the same default).
  error_alert_hours: { group: "limits", type: "int", default: 6, min: 1, max: 24, unit: "hours", choices: [1, 6, 24] },

  // ── Personal data (0182): the version of the CGU and privacy policy people
  //    accept, and how long the nightly jobs keep each trace. The SQL jobs
  //    read these keys with the same defaults; 0 keeps that trace. Payments,
  //    invoices and the admin audit trail are never deleted by them.
  legal_version: { group: "privacy", type: "text", default: "2026-10", max: 40, ltr: true },
  privacy_anonymize_days: { group: "privacy", type: "int", default: 30, min: 1, max: 90, unit: "days", choices: [7, 14, 30, 60, 90] },
  privacy_page_views_days: { group: "privacy", type: "int", default: 90, min: 0, max: 730, unit: "days", choices: [30, 60, 90, 180, 365, 0] },
  privacy_activity_days: { group: "privacy", type: "int", default: 365, min: 0, max: 730, unit: "days", choices: [90, 180, 365, 730, 0] },
  privacy_notifications_days: { group: "privacy", type: "int", default: 30, min: 0, max: 365, unit: "days", choices: [7, 14, 30, 60, 90, 180, 0] },
  privacy_traces_days: { group: "privacy", type: "int", default: 365, min: 0, max: 730, unit: "days", choices: [90, 180, 365, 730, 0] },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: ValueOf<(typeof SETTINGS)[K]> };
export type ClientSettingKey = {
  [K in SettingKey]: (typeof SETTINGS)[K] extends { client: true } ? K : never;
}[SettingKey];
export type ClientSettings = Pick<Settings, ClientSettingKey>;

/** The console's tabs, in order. */
export const SETTING_GROUPS = [
  "features", "home", "moderation", "publication", "buyers", "contact", "social", "payment", "company", "limits", "privacy",
] as const;

export function isSettingKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, k);
}
