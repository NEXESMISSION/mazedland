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
export type PromoConfig = { enabled: boolean; value: number };
export type DepositConfig = { mode: FeeMode; value: number; free_until: string | null };

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
  promoHome: { enabled: true, value: 15 },
  promoTop: { enabled: true, value: 10 },
  promoBanner: { enabled: true, value: 30 },
  deposit: { mode: "percent", value: 10, free_until: null },
};

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

/** A short human label for a fee config, e.g. "Gratuit", "20 TND", "10%". */
export function describeFee(cfg: { mode: FeeMode; value: number }): string {
  if (cfg.mode === "free") return "Gratuit";
  if (cfg.mode === "percent") return `${cfg.value}%`;
  return `${cfg.value} TND`;
}
