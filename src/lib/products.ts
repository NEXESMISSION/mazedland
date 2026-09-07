/**
 * Products, packs, credits and the badge — the shared model.
 *
 * Every price in v3 is a row in `products` (migration 0157), never a constant
 * in code and never a jsonb blob in `app_settings`. Anything that needs to know
 * what something costs reads it through here, so there is exactly one answer to
 * "what does publishing an annonce cost?" and an admin can change it without a
 * deploy.
 */

export const PRODUCT_KINDS = [
  "listing_single",
  "listing_pack",
  "subscription",
  "promo",
  "badge_verified",
  "renewal",
] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** What each kind is for, in the words the admin screen shows. */
export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  listing_single: "Annonce à l'unité",
  listing_pack: "Pack d'annonces",
  subscription: "Abonnement",
  promo: "Mise en avant",
  badge_verified: "Badge vérifié",
  renewal: "Renouvellement",
};

export const PRODUCT_KIND_HINT: Record<ProductKind, string> = {
  listing_single: "Une publication. Le prix peut différer par catégorie.",
  listing_pack: "N publications prépayées, à utiliser quand le vendeur veut.",
  subscription: "Publications sur une période, pour les professionnels.",
  promo: "Accueil, top de la recherche, bannière.",
  badge_verified: "Vendu au vendeur, accordé à la main après vérification.",
  renewal: "Remet une annonce expirée en ligne.",
};

export type Product = {
  id: string;
  slug: string;
  kind: ProductKind;
  nameFr: string;
  nameAr: string | null;
  description: string | null;
  price: number;
  categoryId: string | null;
  listingQuota: number | null;
  durationDays: number | null;
  isActive: boolean;
  sortOrder: number;
};

/** Columns every product read selects. */
export const PRODUCT_SELECT =
  "id, slug, kind, name_fr, name_ar, description, price, category_id, listing_quota, duration_days, is_active, sort_order";

type ProductRow = {
  id: string;
  slug: string;
  kind: string;
  name_fr: string;
  name_ar: string | null;
  description: string | null;
  price: number | string;
  category_id: string | null;
  listing_quota: number | null;
  duration_days: number | null;
  is_active: boolean;
  sort_order: number;
};

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    kind: (PRODUCT_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as ProductKind)
      : "listing_single",
    nameFr: row.name_fr,
    nameAr: row.name_ar,
    description: row.description,
    price: Number(row.price),
    categoryId: row.category_id,
    listingQuota: row.listing_quota,
    durationDays: row.duration_days,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

/**
 * What it costs THIS seller to publish in THIS category.
 *
 * Order matters: a category-specific price beats the global one (D4 — a 200 TND
 * brake pad cannot carry a car's fee). Returns null when nothing is priced,
 * which the caller must treat as "cannot publish", never as "free".
 */
export function resolveListingFee(
  products: Product[],
  categoryId: string | null,
  parentCategoryId: string | null = null,
): Product | null {
  const singles = products.filter((p) => p.isActive && p.kind === "listing_single");
  return (
    // Most specific first: this exact category…
    singles.find((p) => p.categoryId != null && p.categoryId === categoryId) ??
    // …then its parent, so "les terrains sont à 10 TND" is one row an admin
    // sets on « Terrains » rather than one per leaf — and a
    // sub-category added later inherits that answer instead of silently
    // falling back to the global price.
    (parentCategoryId
      ? singles.find((p) => p.categoryId != null && p.categoryId === parentCategoryId)
      : undefined) ??
    // …then the catch-all.
    singles.find((p) => p.categoryId == null) ??
    null
  );
}

/**
 * A fee of zero is FREE — an answer an admin set on purpose. Distinct from
 * `resolveListingFee` returning null, which means nobody has priced this yet
 * and publishing would be a silent revenue hole.
 */
export const isFree = (fee: Product | null): boolean => fee != null && fee.price <= 0;

/** Packs and subscriptions a seller can buy right now, cheapest first. */
export function purchasablePacks(products: Product[]): Product[] {
  return products
    .filter((p) => p.isActive && (p.kind === "listing_pack" || p.kind === "subscription"))
    .sort((a, b) => a.price - b.price);
}

/** The badge product, when it is on sale. */
export function badgeProduct(products: Product[]): Product | null {
  return products.find((p) => p.isActive && p.kind === "badge_verified") ?? null;
}

/**
 * Per-publication cost of a pack — the number that tells a seller whether the
 * pack is worth it, and the one they will compute by hand if we don't.
 */
export function pricePerListing(pack: Product): number | null {
  if (!pack.listingQuota || pack.listingQuota <= 0) return null;
  return Math.round((pack.price / pack.listingQuota) * 100) / 100;
}

// ─── Credits ────────────────────────────────────────────────────────────────

export type SellerCredit = {
  id: string;
  productName: string | null;
  quotaTotal: number;
  quotaUsed: number;
  remaining: number;
  expiresAt: string;
  status: "active" | "exhausted" | "expired" | "revoked";
};

export const SELLER_CREDIT_SELECT =
  "id, quota_total, quota_used, expires_at, status, product:products (name_fr)";

export function toSellerCredit(row: {
  id: string;
  quota_total: number;
  quota_used: number;
  expires_at: string;
  status: string;
  product?: { name_fr: string } | { name_fr: string }[] | null;
}): SellerCredit {
  const prod = Array.isArray(row.product) ? row.product[0] : row.product;
  const status = (["active", "exhausted", "expired", "revoked"] as const).includes(
    row.status as "active",
  )
    ? (row.status as SellerCredit["status"])
    : "expired";
  return {
    id: row.id,
    productName: prod?.name_fr ?? null,
    quotaTotal: row.quota_total,
    quotaUsed: row.quota_used,
    remaining: Math.max(0, row.quota_total - row.quota_used),
    expiresAt: row.expires_at,
    status,
  };
}

/** Publications a seller can still make from their packs, today. */
export function usableCredits(credits: SellerCredit[], now = new Date()): number {
  return credits
    .filter((c) => c.status === "active" && new Date(c.expiresAt) > now)
    .reduce((n, c) => n + c.remaining, 0);
}
