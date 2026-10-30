/**
 * Projects and their units (0179): a promoter's residence, lotissement or
 * commercial building, sold unit by unit before it is finished.
 *
 * The pure part — kinds, the form's choices, input checks, and the unit
 * generator the dashboard offers instead of typing references one by one —
 * is tested on its own (projects.test.ts). The database is read and written
 * by the /api/pro/projects routes and the pages, with the service role.
 */
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { canonicalDelegation } from "@/lib/delegations";

export const PROJECT_KINDS = ["residence", "villas", "lotissement", "commercial", "mixed"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_STATUSES = ["draft", "published", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const UNIT_KINDS = ["apartment", "duplex", "villa", "land", "shop", "office", "parking"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_STATUSES = ["available", "reserved", "sold"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** Units stacked by floor in a building, and units numbered one after the other. */
export const FLOOR_KINDS = ["apartment", "duplex", "office", "shop"] as const satisfies readonly UnitKind[];
export const LOT_KINDS = ["land", "villa", "parking"] as const satisfies readonly UnitKind[];

/** The blocks offered as chips: a building is « A », « B »… */
export const BLOCKS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
/** What numbered units are called: « Lot 7 », « Villa 3 », « P 12 ». */
export const LOT_PREFIXES = { land: "Lot", villa: "Villa", parking: "P" } as const;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export const isProjectKind = (v: unknown): v is ProjectKind => isOneOf(PROJECT_KINDS, v);
export const isUnitKind = (v: unknown): v is UnitKind => isOneOf(UNIT_KINDS, v);
export const isUnitStatus = (v: unknown): v is UnitStatus => isOneOf(UNIT_STATUSES, v);

const DELIVERY = /^20[2-9][0-9]-Q[1-4]$/;
export function isDelivery(v: unknown): v is string {
  return v === "delivered" || (typeof v === "string" && DELIVERY.test(v));
}

/** « Livré », then the quarter we are in and the `count - 1` after it: the form's chips. */
export function deliveryChoices(today: Date, count = 12): string[] {
  const out = ["delivered"];
  let year = today.getUTCFullYear();
  let q = Math.floor(today.getUTCMonth() / 3) + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${year}-Q${q}`);
    q += 1;
    if (q > 4) {
      q = 1;
      year += 1;
    }
  }
  return out;
}

export type ProjectInput = {
  name: string;
  kind: ProjectKind;
  description: string | null;
  governorate: string;
  delegation: string | null;
  address: string | null;
  delivery: string | null;
  cover_path: string | null;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+\n/g, "\n").slice(0, max);
  return t || null;
};

/**
 * A project's fields from a request body. `partial` (an edit) checks only
 * the fields sent; a creation needs a name, a kind and a governorate. The
 * délégation must belong to the governorate.
 */
export function parseProjectInput(
  body: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {},
): { ok: true; value: Partial<ProjectInput> } | { ok: false; field: keyof ProjectInput } {
  const v: Partial<ProjectInput> = {};
  const has = (k: string) => k in body;

  if (!partial || has("name")) {
    const name = text(body.name, 100);
    if (!name || name.length < 2) return { ok: false, field: "name" };
    v.name = name;
  }
  if (!partial || has("kind")) {
    if (!isProjectKind(body.kind)) return { ok: false, field: "kind" };
    v.kind = body.kind;
  }
  if (!partial || has("governorate")) {
    if (!isOneOf(TUNISIAN_GOVERNORATES as readonly string[], body.governorate)) return { ok: false, field: "governorate" };
    v.governorate = body.governorate as string;
  }
  if (has("delegation")) {
    const gov = v.governorate ?? (typeof body.governorate === "string" ? body.governorate : null);
    const raw = text(body.delegation, 80);
    if (raw) {
      const canon = canonicalDelegation(gov, raw);
      if (!canon) return { ok: false, field: "delegation" };
      v.delegation = canon;
    } else v.delegation = null;
  }
  if (has("address")) v.address = text(body.address, 200);
  if (has("description")) v.description = text(body.description, 3000);
  if (has("delivery")) {
    if (body.delivery === null || body.delivery === "") v.delivery = null;
    else if (isDelivery(body.delivery)) v.delivery = body.delivery;
    else return { ok: false, field: "delivery" };
  }
  if (has("cover_path")) {
    const p = text(body.cover_path, 300);
    if (p && p.includes("..")) return { ok: false, field: "cover_path" };
    v.cover_path = p;
  }
  return { ok: true, value: v };
}

/** A unit as the generator makes it, before it has an id. */
export type UnitDraft = {
  ref: string;
  kind: UnitKind;
  block: string | null;
  floor: number | null;
  rooms: number | null;
  area_sqm: number | null;
  price: number | null;
  sort_order: number;
};

/**
 * What the dashboard's « Ajouter des lots » form sends: a building's floors,
 * or a run of numbered lots. One price, surface and room count apply to all;
 * each unit can be corrected afterwards.
 */
export type UnitPlan =
  | {
      mode: "floors";
      kind: (typeof FLOOR_KINDS)[number];
      block: string;
      floorFrom: number;
      floorTo: number;
      perFloor: number;
      rooms: number | null;
      area: number | null;
      price: number | null;
    }
  | {
      mode: "lots";
      kind: (typeof LOT_KINDS)[number];
      from: number;
      count: number;
      area: number | null;
      price: number | null;
    };

const int = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const positive = (v: unknown, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 1000) / 1000 : null;
};
/** A field the form sent with something in it — as opposed to left empty. */
const given = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
/** The most project_units.price (numeric(14,3)) holds: its own ceiling, 100 000 000 000, is an overflow turned 500. */
const PRICE_MAX = 99_999_999_999;

/**
 * The generator's form. A figure left empty is fine (the units get none); a
 * figure typed and wrong — « 250 000 » with a space, 21 rooms, a negative
 * price — refuses the plan, as the unit editor refuses it, instead of making
 * the units without it (the QA tour, 2026-10-30).
 */
export function parseUnitPlan(body: Record<string, unknown>): UnitPlan | null {
  const area = positive(body.area, 100_000);
  const price = positive(body.price, PRICE_MAX);
  if ((given(body.area) && area === null) || (given(body.price) && price === null)) return null;
  if (body.mode === "floors") {
    if (!isOneOf(FLOOR_KINDS, body.kind) || !isOneOf(BLOCKS as readonly string[], body.block)) return null;
    const floorFrom = int(body.floorFrom, 0, 60);
    const floorTo = int(body.floorTo, 0, 60);
    const perFloor = int(body.perFloor, 1, 20);
    if (floorFrom === null || floorTo === null || perFloor === null || floorTo < floorFrom) return null;
    const rooms = given(body.rooms) ? int(body.rooms, 0, 20) : null;
    if (given(body.rooms) && rooms === null) return null;
    return { mode: "floors", kind: body.kind, block: body.block as string, floorFrom, floorTo, perFloor, rooms, area, price };
  }
  if (body.mode === "lots") {
    if (!isOneOf(LOT_KINDS, body.kind)) return null;
    const from = int(body.from ?? 1, 1, 9999);
    const count = int(body.count, 1, 2000);
    if (from === null || count === null) return null;
    return { mode: "lots", kind: body.kind, from, count, area, price };
  }
  return null;
}

/** How many units a plan makes, before making them. */
export function unitPlanSize(plan: UnitPlan): number {
  return plan.mode === "floors" ? (plan.floorTo - plan.floorFrom + 1) * plan.perFloor : plan.count;
}

/**
 * The units of a plan, references made the way promoters write them: a
 * building's A-001, A-002 … A-101 (block, floor, number on the floor), or
 * Lot 1, Lot 2 … `startOrder` follows the units already in the project.
 */
export function planUnits(plan: UnitPlan, startOrder = 0): UnitDraft[] {
  const out: UnitDraft[] = [];
  if (plan.mode === "floors") {
    for (let floor = plan.floorFrom; floor <= plan.floorTo; floor++) {
      for (let n = 1; n <= plan.perFloor; n++) {
        out.push({
          ref: `${plan.block}-${floor}${String(n).padStart(2, "0")}`,
          kind: plan.kind,
          block: plan.block,
          floor,
          rooms: plan.rooms,
          area_sqm: plan.area,
          price: plan.price,
          sort_order: startOrder + out.length,
        });
      }
    }
  } else {
    for (let i = 0; i < plan.count; i++) {
      out.push({
        ref: `${LOT_PREFIXES[plan.kind]} ${plan.from + i}`,
        kind: plan.kind,
        block: null,
        floor: null,
        rooms: null,
        area_sqm: plan.area,
        price: plan.price,
        sort_order: startOrder + i,
      });
    }
  }
  return out;
}

/** One unit's correction from the dashboard: its status, price, surface or rooms. */
export function parseUnitPatch(
  body: Record<string, unknown>,
): { ok: true; value: Partial<Pick<UnitDraft, "price" | "area_sqm" | "rooms">> & { status?: UnitStatus } } | { ok: false } {
  const v: Partial<Pick<UnitDraft, "price" | "area_sqm" | "rooms">> & { status?: UnitStatus } = {};
  if ("status" in body) {
    if (!isUnitStatus(body.status)) return { ok: false };
    v.status = body.status;
  }
  if ("price" in body) {
    const p = positive(body.price, PRICE_MAX);
    if (body.price !== null && body.price !== "" && p === null) return { ok: false };
    v.price = p;
  }
  if ("area_sqm" in body) {
    const a = positive(body.area_sqm, 100_000);
    if (body.area_sqm !== null && body.area_sqm !== "" && a === null) return { ok: false };
    v.area_sqm = a;
  }
  if ("rooms" in body) {
    const r = body.rooms === null || body.rooms === "" ? null : int(body.rooms, 0, 20);
    if (body.rooms !== null && body.rooms !== "" && r === null) return { ok: false };
    v.rooms = r;
  }
  return Object.keys(v).length ? { ok: true, value: v } : { ok: false };
}

export type UnitCounts = { total: number; available: number; reserved: number; sold: number };

export function unitCounts(units: readonly { status: string }[]): UnitCounts {
  const c: UnitCounts = { total: units.length, available: 0, reserved: 0, sold: 0 };
  for (const u of units) if (isUnitStatus(u.status)) c[u.status] += 1;
  return c;
}

/** The lowest price among the units still available, for the project's card. */
export function priceFrom(units: readonly { status: string; price: number | string | null }[]): number | null {
  let min: number | null = null;
  for (const u of units) {
    if (u.status !== "available" || u.price === null) continue;
    const p = Number(u.price);
    if (p > 0 && (min === null || p < min)) min = p;
  }
  return min;
}

/** A delivery value in parts, for « Livré » or « 2e trimestre 2027 ». */
export function deliveryParts(v: string | null | undefined): { delivered: true } | { delivered: false; year: number; q: number } | null {
  if (v === "delivered") return { delivered: true };
  const m = typeof v === "string" ? /^(\d{4})-Q([1-4])$/.exec(v) : null;
  return m ? { delivered: false, year: Number(m[1]), q: Number(m[2]) } : null;
}
