import { describe, it, expect } from "vitest";
import { publishListing } from "./publish";

/**
 * A stand-in for the service-role client: tables of rows in memory, filters,
 * updates applied to the rows they match and reported back, notifications
 * collected. Enough for the publication itself; the demandes it then alerts
 * never throw, so they need nothing here.
 */
type Row = Record<string, unknown>;

function fakeAdmin(tables: Record<string, Row[]>) {
  const notices: Row[] = [];
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let values: Row | null = null;
    let single = false;
    const b = {
      select: () => b,
      update: (v: Row) => { values = v; return b; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
      limit: () => b,
      maybeSingle: () => { single = true; return b; },
      then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (values) for (const r of rows) Object.assign(r, values);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(ok, bad);
      },
    };
    return b;
  }
  const rpc = (_name: string, args: Row) => {
    notices.push(args);
    return { then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) };
  };
  return { client: { from, rpc } as never, notices };
}

const annonce = { id: "L1", seller_id: "S", title: "Appartement S+2", fee_payment_id: null };

function db(status: string) {
  const row: Row = { id: "L1", seller_id: "S", title: "Appartement S+2", status, published_at: null };
  const fake = fakeAdmin({
    listings: [row],
    products: [{ kind: "listing_single", is_active: true, duration_days: 30 }],
  });
  return { ...fake, row };
}

describe("publishListing with `from`", () => {
  it("publishes an annonce whose status the caller allows, and tells the seller once", async () => {
    const { client, row, notices } = db("pending_review");
    const out = await publishListing(client, annonce, { reviewerId: "ADMIN", from: ["pending_review", "pending_payment"] });
    expect(out.ok).toBe(true);
    expect(row).toMatchObject({ status: "published", reviewed_by: "ADMIN" });
    expect(notices.filter((n) => n.p_kind === "listing_published")).toHaveLength(1);
  });

  it("leaves a draft with its seller", async () => {
    const { client, row, notices } = db("draft");
    const out = await publishListing(client, annonce, { reviewerId: "ADMIN", from: ["pending_review", "pending_payment"] });
    expect(out).toMatchObject({ ok: false, wrongStatus: true });
    expect(row.status).toBe("draft");
    expect(notices).toHaveLength(0);
  });

  it("does not publish twice: the second approval finds nothing to move", async () => {
    const { client, row, notices } = db("pending_review");
    const from = ["pending_review"];
    const first = await publishListing(client, annonce, { reviewerId: "A", from });
    const publishedAt = row.published_at;
    const second = await publishListing(client, annonce, { reviewerId: "B", from });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, wrongStatus: true });
    expect(row).toMatchObject({ reviewed_by: "A", published_at: publishedAt });
    expect(notices.filter((n) => n.p_kind === "listing_published")).toHaveLength(1);
  });

  it("without `from`, publishes whatever the status — the automatic path decided before calling", async () => {
    const { client, row } = db("pending_review");
    expect((await publishListing(client, annonce, { reviewerId: null })).ok).toBe(true);
    expect(row).toMatchObject({ status: "published", reviewed_by: null, reviewed_at: null });
  });
});
