import { describe, it, expect } from "vitest";
import { takeDownListing } from "./takedown";

/**
 * Just enough of the service-role client for a takedown: one table of rows in
 * memory, filters, an update that reports the rows it touched, and the
 * notifications it enqueued. The real thing cannot be exercised here — the
 * only database is production.
 */
type Row = Record<string, unknown>;

function fakeAdmin(listings: Row[]) {
  const notices: Row[] = [];
  function from() {
    const filters: ((r: Row) => boolean)[] = [];
    let values: Row | null = null;
    const b = {
      update: (v: Row) => { values = v; return b; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
      select: () => b,
      then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        const rows = listings.filter((r) => filters.every((f) => f(r)));
        if (values) for (const r of rows) Object.assign(r, values);
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null }).then(ok, bad);
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

const live = (): Row => ({ id: "L1", seller_id: "S", title: "Villa à Gammarth", status: "published", taken_down_at: null });

describe("takeDownListing", () => {
  it("takes the annonce down once, with the reason, and tells the seller", async () => {
    const row = live();
    const { client, notices } = fakeAdmin([row]);

    const out = await takeDownListing(client, { id: "L1", seller_id: "S", title: "Villa à Gammarth" }, { byId: "ADMIN", reason: "annonce en double" });

    expect(out).toEqual({ ok: true });
    expect(row).toMatchObject({ status: "archived", taken_down_by: "ADMIN", taken_down_reason: "annonce en double" });
    expect(row.taken_down_at).toBeTruthy();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      p_user_id: "S",
      p_kind: "listing_archived",
      p_payload: { vars: { title: "Villa à Gammarth", variant: "withReason", reason: "annonce en double" } },
    });
  });

  it("changes nothing and tells nobody the second time", async () => {
    const row = live();
    const { client, notices } = fakeAdmin([row]);
    const listing = { id: "L1", seller_id: "S", title: "Villa à Gammarth" };

    await takeDownListing(client, listing, { byId: "ADMIN", reason: "annonce en double" });
    const firstAt = row.taken_down_at;
    const again = await takeDownListing(client, listing, { byId: "OTHER", reason: "bien vendu" });

    expect(again).toEqual({ ok: false, already: true, error: null });
    expect(row).toMatchObject({ taken_down_by: "ADMIN", taken_down_reason: "annonce en double", taken_down_at: firstAt });
    expect(notices).toHaveLength(1);
  });

  it("sends the plain notice when the moderator gave no reason", async () => {
    const row = live();
    const { client, notices } = fakeAdmin([row]);

    await takeDownListing(client, { id: "L1", seller_id: "S", title: "Villa à Gammarth" }, { byId: "ADMIN", reason: "   " });

    expect(row.taken_down_reason).toBeNull();
    expect(notices[0]).toMatchObject({ p_payload: { vars: { title: "Villa à Gammarth", variant: "plain" } } });
    expect((notices[0].p_payload as { vars: Row }).vars).not.toHaveProperty("reason");
  });
});
