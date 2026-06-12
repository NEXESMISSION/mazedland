/**
 * Single source of truth for every fee/deposit in the app. The owner tunes
 * these from /admin/settings; every surface (sell form, initiate-payment,
 * deposit route, checkout, bid gate) resolves money through this module so
 * there's no scattered, drifting math.
 *
 * Config lives in app_settings as structured jsonb (see migration 0040).
 */

export type FeeMode = "free" | "fixed" | "percent";

export type ListingFeeConfig = { mode: FeeMode; value: number };
/** A paid promo add-on: whether it's offered, its price, and how many days
 *  it stays active once a paid listing is approved. */
export type PromoConfig = { enabled: boolean; value: number; duration_days: number };
export type DepositConfig = { mode: FeeMode; value: number; free_until: string | null };

/** The three promo slots, keyed the way payments.metadata.promos + the
 *  accept_listing_payment RPC expect them. */
export type PromoKey = "home_featured" | "top_listed" | "banner";

export type MonetizationSettings = {
  feeListingAuction: ListingFeeConfig;
  feeListingDirect: ListingFeeConfig;
  promoHome: PromoConfig;
  promoTop: PromoConfig;
  promoBanner: PromoConfig;
  deposit: DepositConfig;
};

export const DEFAULT_MONETIZATION: MonetizationSettings = {
  feeListingAuction: { mode: "fixed", value: 20 },
  feeListingDirect: { mode: "fixed", value: 15 },
  promoHome: { enabled: true, value: 15, duration_days: 30 },
  promoTop: { enabled: true, value: 10, duration_days: 30 },
  promoBanner: { enabled: true, value: 30, duration_days: 30 },
  deposit: { mode: "percent", value: 10, free_until: null },
};

/** Clamp a promo duration to a sane 1–365 day window (defaulting when unset). */
export function cleanDurationDays(raw: unknown, fallback = 30): number {
  const n = Math.floor(num(raw, fallback));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(365, n);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const mode = (v: unknown, fallback: FeeMode): FeeMode =>
  v === "free" || v === "fixed" || v === "percent" ? v : fallback;

function listingCfg(raw: unknown, def: ListingFeeConfig): ListingFeeConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return { mode: mode(o.mode, def.mode), value: num(o.value, def.value) };
}
function promoCfg(raw: unknown, def: PromoConfig): PromoConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : def.enabled,
    value: num(o.value, def.value),
    duration_days: cleanDurationDays(o.duration_days, def.duration_days),
  };
}
function depositCfg(raw: unknown, def: DepositConfig): DepositConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    mode: mode(o.mode, def.mode),
    value: num(o.value, def.value),
    free_until: typeof o.free_until === "string" && o.free_until ? o.free_until : null,
  };
}

/** Build the typed settings from an app_settings key→value map. */
export function parseMonetizationSettings(
  map: Map<string, unknown>,
): MonetizationSettings {
  const d = DEFAULT_MONETIZATION;
  return {
    feeListingAuction: listingCfg(map.get("fee_listing_auction"), d.feeListingAuction),
    feeListingDirect: listingCfg(map.get("fee_listing_direct"), d.feeListingDirect),
    promoHome: promoCfg(map.get("promo_home"), d.promoHome),
    promoTop: promoCfg(map.get("promo_top"), d.promoTop),
    promoBanner: promoCfg(map.get("promo_banner"), d.promoBanner),
    deposit: depositCfg(map.get("deposit"), d.deposit),
  };
}

/**
 * Anti-sniping (auction time-extension) config — admin-controlled, stored in
 * MINUTES under the `auction_antisnipe` app_settings key. A bid landing in the
 * last `windowMin` before the end pushes the close out by `extendMin`.
 * Defaults match the original DB column defaults (5-min window, 10-min push).
 */
export type AntiSnipeSettings = { windowMin: number; extendMin: number };
export const DEFAULT_ANTISNIPE: AntiSnipeSettings = { windowMin: 5, extendMin: 10 };

export function parseAntiSnipe(raw: unknown): AntiSnipeSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  // Cap at 120 min so a fat-fingered value can't freeze an auction open.
  const clampMin = (v: unknown, fb: number) => {
    const n = Math.round(num(v, fb));
    return Number.isFinite(n) && n >= 0 ? Math.min(120, n) : fb;
  };
  return {
    windowMin: clampMin(o.window_min, DEFAULT_ANTISNIPE.windowMin),
    extendMin: clampMin(o.extend_min, DEFAULT_ANTISNIPE.extendMin),
  };
}

/**
 * Which auction FORMATS the admin has switched on for sellers. English is the
 * always-available standard, so it isn't stored — only the optional extras
 * (Dégressive / dutch, Cachetée / sealed) are toggled. Default: both OFF, i.e.
 * an English-only marketplace until the admin opts in. The DB guard trigger
 * (migration 0130) enforces the same defaults server-side.
 */
export type AuctionTypeSettings = { dutchEnabled: boolean; sealedEnabled: boolean };
export const DEFAULT_AUCTION_TYPES: AuctionTypeSettings = {
  dutchEnabled: false,
  sealedEnabled: false,
};

export function parseAuctionTypes(raw: unknown): AuctionTypeSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    dutchEnabled: o.dutch_enabled === true,
    sealedEnabled: o.sealed_enabled === true,
  };
}

/**
 * Number of days the winning bidder has to settle the balance after a sale.
 * Admin-tunable; clamped to a sane 1..90. Default 14. The DB helper
 * final_payment_interval() (migration 0131) reads the same setting so the cron
 * state machine and the UI explainer always agree.
 */
export const DEFAULT_FINAL_PAYMENT_DAYS = 14;

export function parseFinalPaymentDays(raw: unknown): number {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = Math.round(num(o.days, DEFAULT_FINAL_PAYMENT_DAYS));
  return Number.isFinite(n) && n >= 1 ? Math.min(90, n) : DEFAULT_FINAL_PAYMENT_DAYS;
}

/**
 * Listing fee in TND. `declaredPrice` is the seller's sale price (direct
 * offers) — required for percent mode. Auctions have no price at posting
 * time, so percent there resolves to 0 (the admin UI restricts auctions to
 * free/fixed anyway).
 */
export function resolveListingFee(
  cfg: ListingFeeConfig,
  declaredPrice: number | null,
): number {
  if (cfg.mode === "free") return 0;
  if (cfg.mode === "fixed") return round2(Math.max(0, cfg.value));
  if (declaredPrice == null || declaredPrice <= 0) return 0;
  return round2((declaredPrice * cfg.value) / 100);
}

/**
 * Bid deposit. Returns `required:false` (amount 0) when the owner set the
 * deposit to free, or while the global free window is open.
 */
export function resolveDeposit(
  cfg: DepositConfig,
  openingPrice: number,
  now: Date = new Date(),
): { required: boolean; amount: number } {
  const freeWindow = cfg.free_until ? new Date(cfg.free_until) > now : false;
  if (cfg.mode === "free" || freeWindow) return { required: false, amount: 0 };
  if (cfg.mode === "fixed") return { required: true, amount: round2(Math.max(0, cfg.value)) };
  return { required: true, amount: round2((openingPrice * cfg.value) / 100) };
}

/**
 * Translate the promos a seller actually paid for (payments.metadata.promos)
 * into the per-promo day durations the accept_listing_payment RPC applies.
 * A promo only gets a duration when the seller bought it — so a seller always
 * gets exactly what they paid for, for the admin-configured number of days,
 * and never anything they didn't buy.
 */
export function resolvePromoDurations(
  promos: Partial<Record<PromoKey, boolean>> | null | undefined,
  mon: MonetizationSettings,
): Record<PromoKey, number> {
  const p = promos ?? {};
  return {
    home_featured: p.home_featured ? mon.promoHome.duration_days : 0,
    top_listed: p.top_listed ? mon.promoTop.duration_days : 0,
    banner: p.banner ? mon.promoBanner.duration_days : 0,
  };
}

/** A short human label for a fee config, e.g. "Gratuit", "20 TND", "10%". */
export function describeFee(cfg: { mode: FeeMode; value: number }): string {
  if (cfg.mode === "free") return "Gratuit";
  if (cfg.mode === "percent") return `${cfg.value}%`;
  return `${cfg.value} TND`;
}
