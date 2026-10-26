import { describe, it, expect } from "vitest";
import { publishOrQueue, type ModerationSettings } from "./server";

/**
 * A stand-in for the service-role client, just enough of the query builder for
 * the moderation decision: rows live in memory, filters are applied, updates
 * are recorded. The real thing cannot be exercised here — the only database is
 * production.
 */
type Row = Record<string, unknown>;

function fakeAdmin(tables: Record<string, Row[]>) {
  const updates: { table: string; values: Row; filters: [string, string, unknown][] }[] = [];

  function from(table: string) {
    const filters: [string, string, unknown][] = [];
    let mode: "select" | "update" = "select";
    let values: Row = {};
    let head = false;
    let single = false;

    const matches = (r: Row) =>
      filters.every(([op, col, v]) => {
        const x = r[col];
        switch (op) {
          case "eq": return x === v;
          case "neq": return x !== v;
          case "in": return (v as unknown[]).includes(x);
          case "notnull": return x !== null && x !== undefined;
          case "isnull": return x === null || x === undefined;
          case "contains": return Array.isArray(x) && (v as unknown[]).every((e) => x.includes(e));
          default: return true;
        }
      });

    const run = () => {
      const rows = (tables[table] ?? []).filter(matches);
      if (mode === "update") {
        updates.push({ table, values, filters: [...filters] });
        for (const r of rows) Object.assign(r, values);
        return { data: rows, error: null, count: null };
      }
      if (head) return { data: null, error: null, count: rows.length };
      return { data: single ? rows[0] ?? null : rows, error: null, count: rows.length };
    };

    const b = {
      select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b; },
      update: (v: Row) => { mode = "update"; values = v; return b; },
      eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return b; },
      neq: (c: string, v: unknown) => { filters.push(["neq", c, v]); return b; },
      in: (c: string, v: unknown[]) => { filters.push(["in", c, v]); return b; },
      not: (c: string) => { filters.push(["notnull", c, null]); return b; },
      is: (c: string) => { filters.push(["isnull", c, null]); return b; },
      contains: (c: string, v: unknown[]) => { filters.push(["contains", c, v]); return b; },
      limit: () => b,
      maybeSingle: () => { single = true; return b; },
      then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  }

  const rpc = () => ({ then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) });
  return { client: { from, rpc } as never, updates };
}

const SETTINGS: ModerationSettings = {
  freeLimit: 2,
  autoPublish: true,
  minPhotos: 3,
  reportThreshold: 3,
  bannedWords: ["casino"],
};

const listing = (over: Row = {}): Row => ({
  id: "L1",
  seller_id: "S",
  category_id: "C-villas",
  title: "Villa avec jardin · Sakiet Ezzit",
  description: "Belle villa de 4 pièces, proche des écoles.",
  price: 650000,
  price_on_request: false,
  governorate: "Sfax",
  attributes: { area_sqm: 250 },
  fee_payment_id: null,
  deal_type: "sale",
  status: "draft",
  review_flags: [],
  ...over,
});

function db({
  approvedBefore,
  photos = 4,
  extraListings = [] as Row[],
  banned = false,
  main = {},
}: { approvedBefore: boolean; photos?: number; extraListings?: Row[]; banned?: boolean; main?: Row }) {
  const previous = approvedBefore
    ? [listing({ id: "OLD", status: "expired", reviewed_by: "ADMIN", published_at: "2026-09-01", title: "Autre bien" })]
    : [];
  return fakeAdmin({
    listings: [listing(main), ...previous, ...extraListings],
    listing_photos: Array.from({ length: photos }, (_, i) => ({ id: `p${i}`, listing_id: "L1" })),
    categories: [{ id: "C-villas", kind: "residential" }],
    profiles: [{ id: "S", banned_at: banned ? "2026-10-01" : null }],
    products: [{ kind: "listing_single", is_active: true, duration_days: 30 }],
    listing_reports: [],
  });
}

const statusOf = (updates: ReturnType<typeof fakeAdmin>["updates"]) =>
  updates.filter((u) => u.table === "listings").map((u) => u.values.status);

describe("publishOrQueue", () => {
  it("sends a seller's first annonce to a human, even when it is clean", async () => {
    const { client, updates } = db({ approvedBefore: false });
    const out = await publishOrQueue(client, "L1", SETTINGS);
    expect(out).toEqual({ status: "pending_review", flags: ["first_listing"] });
    expect(statusOf(updates)).toEqual(["pending_review"]);
  });

  it("publishes a trusted seller's clean annonce on the spot", async () => {
    const { client, updates } = db({ approvedBefore: true });
    const out = await publishOrQueue(client, "L1", SETTINGS);
    expect(out.status).toBe("published");
    const write = updates.find((u) => u.table === "listings")!;
    expect(write.values).toMatchObject({ status: "published", reviewed_by: null, review_flags: [] });
  });

  it("holds a trusted seller's annonce that breaks a rule, and says which", async () => {
    const { client } = db({ approvedBefore: true, photos: 1 });
    expect(await publishOrQueue(client, "L1", SETTINGS)).toEqual({
      status: "pending_review",
      flags: ["too_few_photos"],
    });
  });

  it("publishes nothing by itself when an admin switched auto-publication off", async () => {
    const off = { ...SETTINGS, autoPublish: false };
    const clean = db({ approvedBefore: true });
    expect(await publishOrQueue(clean.client, "L1", off)).toEqual({ status: "pending_review", flags: [] });
    expect(statusOf(clean.updates)).toEqual(["pending_review"]);

    // The reasons are still worked out and kept, for the admin who reads it.
    const thin = db({ approvedBefore: true, photos: 1 });
    expect(await publishOrQueue(thin.client, "L1", off)).toEqual({
      status: "pending_review",
      flags: ["too_few_photos"],
    });
    expect(thin.updates.find((u) => u.table === "listings")!.values).toMatchObject({
      status: "pending_review",
      review_flags: ["too_few_photos"],
    });
  });

  it("counts photos against the minimum an admin set", async () => {
    const strict = db({ approvedBefore: true, photos: 4 });
    expect(await publishOrQueue(strict.client, "L1", { ...SETTINGS, minPhotos: 5 })).toEqual({
      status: "pending_review",
      flags: ["too_few_photos"],
    });
    const lenient = db({ approvedBefore: true, photos: 1 });
    expect((await publishOrQueue(lenient.client, "L1", { ...SETTINGS, minPhotos: 1 })).status).toBe("published");
  });

  it("spots the same property posted twice", async () => {
    const twin = listing({ id: "L2", status: "published", title: "villa avec jardin – Sakiet Ezzit" });
    const { client } = db({ approvedBefore: true, extraListings: [twin] });
    expect(await publishOrQueue(client, "L1", SETTINGS)).toEqual({
      status: "pending_review",
      flags: ["duplicate"],
    });
  });

  it("lets the same flat be offered for sale and for rent at once", async () => {
    const forRent = listing({ id: "L2", status: "published", deal_type: "rent", price: 1_800 });
    const { client } = db({ approvedBefore: true, extraListings: [forRent] });
    expect((await publishOrQueue(client, "L1", SETTINGS)).status).toBe("published");
  });

  it("judges a rental's price as a monthly rent", async () => {
    // 1 800 TND a month for 250 m² is a rent; as a sale price it would be held.
    const rental = db({ approvedBefore: true, main: { deal_type: "rent", price: 1_800 } });
    expect((await publishOrQueue(rental.client, "L1", SETTINGS)).status).toBe("published");
    const sale = db({ approvedBefore: true, main: { price: 1_800 } });
    expect(await publishOrQueue(sale.client, "L1", SETTINGS)).toEqual({
      status: "pending_review",
      flags: ["price_implausible"],
    });
  });

  it("does not trust a banned seller or one with a reported annonce", async () => {
    const banned = db({ approvedBefore: true, banned: true });
    expect((await publishOrQueue(banned.client, "L1", SETTINGS)).status).toBe("pending_review");

    // A different property (price and area differ), so only the report matters.
    const held = listing({
      id: "L3",
      status: "pending_review",
      review_flags: ["reported"],
      title: "Terrain",
      price: 90000,
      attributes: { area_sqm: 5000 },
    });
    const reported = db({ approvedBefore: true, extraListings: [held] });
    const out = await publishOrQueue(reported.client, "L1", SETTINGS);
    expect(out).toEqual({ status: "pending_review", flags: ["first_listing"] });
  });
});
