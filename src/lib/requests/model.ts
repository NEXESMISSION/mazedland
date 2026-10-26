/**
 * Demandes (0168): what a buyer or a tenant is looking for, and whether an
 * annonce answers it.
 *
 * Pure — the API validates with `parseRequestInput`, the publish path decides
 * with `matchRequest`, and both are unit-tested without a database.
 *
 * A demande's conditions are HARD: a budget ceiling is a ceiling, and an
 * annonce over it is not "a near match" to be suggested anyway (cahier des
 * charges §4). What an annonce does not state — its furniture, the date it is
 * free — is neither a pass nor a fail: it is reported as unknown, the annonce
 * still reaches the person, and the page says what could not be checked.
 */
import { asDealType, FURNISHED, isoDay, type DealType, type Furnished } from "@/lib/listings/deal";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

/**
 * When a demande made or renewed now stops: `days` is the console's
 * `requests_days` (60 by default), read by the route and passed in.
 */
export function requestExpiresAt(days: number, now: number = Date.now()): string {
  return new Date(now + days * 86_400_000).toISOString();
}

export type RequestInput = {
  deal_type: DealType;
  category_ids: string[];
  governorates: string[];
  budget_min: number | null;
  budget_max: number | null;
  surface_min: number | null;
  rooms_min: number | null;
  furnished: Furnished | null;
  move_in_by: string | null;
  note: string | null;
  alerts: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function positive(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null;
}

/**
 * A request body as a demande, or the reason it cannot be one. Unknown
 * categories and governorates are dropped rather than refused — the form only
 * offers real ones, so anything else is a stale tab or a hand-made request.
 */
export function parseRequestInput(
  body: Record<string, unknown>,
): { ok: true; value: RequestInput } | { ok: false; error: "budget_required" | "budget_order" } {
  const deal = asDealType(body.deal_type);
  const ids = Array.isArray(body.category_ids) ? body.category_ids : [];
  const govs = Array.isArray(body.governorates) ? body.governorates : [];
  const rooms = Math.floor(Number(body.rooms_min));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

  const value: RequestInput = {
    deal_type: deal,
    category_ids: [...new Set(ids.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 8),
    governorates: [
      ...new Set(
        govs.filter((g): g is string => typeof g === "string" && (TUNISIAN_GOVERNORATES as readonly string[]).includes(g)),
      ),
    ].slice(0, 5),
    budget_min: positive(body.budget_min),
    budget_max: positive(body.budget_max),
    surface_min: positive(body.surface_min),
    rooms_min: rooms >= 1 && rooms <= 10 ? rooms : null,
    furnished:
      deal === "rent" && (FURNISHED as readonly unknown[]).includes(body.furnished)
        ? (body.furnished as Furnished)
        : null,
    move_in_by: deal === "rent" ? isoDay(body.move_in_by) : null,
    note: note || null,
    alerts: body.alerts !== false,
  };

  // The ceiling is the one thing a demande cannot do without: it is what makes
  // every match worth sending.
  if (value.budget_max == null) return { ok: false, error: "budget_required" };
  if (value.budget_min != null && value.budget_min > value.budget_max) {
    return { ok: false, error: "budget_order" };
  }
  return { ok: true, value };
}

/** The part of an annonce a demande is checked against. */
export type MatchableListing = {
  deal_type: string | null;
  category_id: string;
  governorate: string;
  price: number | null;
  price_on_request: boolean;
  attributes: Record<string, unknown> | null;
  furnished: string | null;
  available_from: string | null;
};

export type MatchableRequest = Pick<
  RequestInput,
  "deal_type" | "category_ids" | "governorates" | "budget_min" | "budget_max" |
  "surface_min" | "rooms_min" | "furnished" | "move_in_by"
>;

export type Criterion = "deal" | "category" | "governorate" | "budget" | "surface" | "rooms" | "furnished" | "move_in";

export type MatchResult = {
  /** Every hard condition is met or could not be checked. */
  ok: boolean;
  met: Criterion[];
  failed: Criterion[];
  /** Conditions the annonce does not say enough to check. */
  unknown: Criterion[];
  /** Share of the demande's conditions known to be met, 0–100. */
  score: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function matchRequest(listing: MatchableListing, request: MatchableRequest): MatchResult {
  const met: Criterion[] = [];
  const failed: Criterion[] = [];
  const unknown: Criterion[] = [];
  const check = (c: Criterion, verdict: boolean | null) =>
    (verdict === null ? unknown : verdict ? met : failed).push(c);

  // A tenant is never sent a flat for sale, and the reverse (§7).
  check("deal", asDealType(listing.deal_type) === request.deal_type);

  if (request.category_ids.length > 0) check("category", request.category_ids.includes(listing.category_id));
  if (request.governorates.length > 0) check("governorate", request.governorates.includes(listing.governorate));

  if (request.budget_max != null || request.budget_min != null) {
    const price = listing.price_on_request ? null : num(listing.price);
    check(
      "budget",
      price == null
        ? null
        : (request.budget_max == null || price <= request.budget_max) &&
            (request.budget_min == null || price >= request.budget_min),
    );
  }

  const attrs = listing.attributes ?? {};
  if (request.surface_min != null) {
    const area = num(attrs.area_sqm);
    check("surface", area == null ? null : area >= request.surface_min);
  }
  if (request.rooms_min != null) {
    const rooms = num(attrs.rooms);
    check("rooms", rooms == null ? null : rooms >= request.rooms_min);
  }

  if (request.deal_type === "rent") {
    if (request.furnished) {
      check("furnished", listing.furnished ? listing.furnished === request.furnished : null);
    }
    if (request.move_in_by) {
      check("move_in", listing.available_from ? listing.available_from <= request.move_in_by : null);
    }
  }

  const known = met.length + failed.length + unknown.length;
  return {
    ok: failed.length === 0,
    met,
    failed,
    unknown,
    score: known === 0 ? 0 : Math.round((met.length / known) * 100),
  };
}

/**
 * The catalogue search a demande stands for, so « Voir les annonces » shows
 * what is online today with the same conditions. The catalogue filters on one
 * category and one governorate; with several, the first is used and the page
 * is wider than the demande, never narrower.
 */
export function catalogueQueryFor(
  r: MatchableRequest,
  categorySlugById: Map<string, string>,
): string {
  const p = new URLSearchParams();
  p.set("deal", r.deal_type);
  if (r.category_ids.length === 1) {
    const slug = categorySlugById.get(r.category_ids[0]);
    if (slug) p.set("cat", slug);
  }
  if (r.governorates.length === 1) p.set("gov", r.governorates[0]);
  if (r.budget_min) p.set("min", String(Math.floor(r.budget_min)));
  if (r.budget_max) p.set("max", String(Math.floor(r.budget_max)));
  if (r.surface_min) p.set("surface", String(Math.floor(r.surface_min)));
  if (r.rooms_min) p.set("rooms", String(r.rooms_min));
  if (r.deal_type === "rent" && r.furnished) p.set("furnished", r.furnished);
  if (r.deal_type === "rent" && r.move_in_by) p.set("avail", r.move_in_by);
  return `/annonces?${p.toString()}`;
}
