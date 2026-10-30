import { describe, expect, it } from "vitest";
import { buildReport, canCompare, change, parsePeriod, periodDays, reportCsv, type RawReport, type ReportListing } from "./reports";

const L = (id: string, sellerId: string, status = "published", title = id): ReportListing => ({ id, reference: `MZ-${id}`, title, sellerId, status });

describe("agence reports", () => {
  it("offers 7, 30 or 90 days and reads anything else as 30", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod(90)).toBe(90);
    expect(parsePeriod("45")).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
  });

  it("counts the period's days back from today, today included", () => {
    expect(periodDays("2026-10-27", 3)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(periodDays("2026-03-01", 2)).toEqual(["2026-02-28", "2026-03-01"]);
  });

  it("adds the counts up by day, by annonce and in total; the period before apart", () => {
    const raw: RawReport = {
      visitors: [["a", "2026-10-27", 3], ["a", "2026-10-21", 2], ["b", "2026-10-26", 1], ["a", "2026-10-20", 5], ["a", "2026-10-10", 9]],
      reveals: [["b", "2026-10-27", 2], ["b", "2026-10-15", 1]],
      leads: [[null, "2026-10-25", 1]],
    };
    const r = buildReport({ raw, days: 7, today: "2026-10-27", listings: [L("a", "u1"), L("b", "u2")], members: [], byAgent: false, tracesKeptDays: 365 });
    expect(r.from).toBe("2026-10-21");
    expect(r.totals).toEqual({ visitors: 6, reveals: 2, favourites: 0, visits: 0, leads: 1 });
    // 2026-10-14 … 2026-10-20 is the period before; the 10th is older than both.
    expect(r.previous).toEqual({ visitors: 5, reveals: 1, favourites: 0, visits: 0, leads: 0 });
    expect(r.series).toHaveLength(7);
    expect(r.series.at(-1)).toMatchObject({ day: "2026-10-27", visitors: 3, reveals: 2 });
    expect(r.listings.map((l) => [l.id, l.visitors, l.reveals])).toEqual([["a", 5, 0], ["b", 1, 2]]);
  });

  it("a lead with no annonce counts in the total, not in a line", () => {
    const r = buildReport({ raw: { leads: [[null, "2026-10-27", 2]] }, days: 7, today: "2026-10-27", listings: [L("a", "u1")], members: [], byAgent: false, tracesKeptDays: 0 });
    expect(r.totals.leads).toBe(2);
    expect(r.listings[0].leads).toBe(0);
  });

  it("keeps an annonce that went offline only when it did something in the period", () => {
    const listings = [L("on", "u"), L("off-quiet", "u", "archived"), L("off-busy", "u", "archived")];
    const r = buildReport({ raw: { reveals: [["off-busy", "2026-10-27", 1]] }, days: 7, today: "2026-10-27", listings, members: [], byAgent: false, tracesKeptDays: 0 });
    expect(r.listings.map((l) => l.id).sort()).toEqual(["off-busy", "on"]);
  });

  it("sums each agent's annonces, with their annonces online", () => {
    const listings = [L("a", "u1"), L("b", "u1", "archived"), L("c", "u2")];
    const raw: RawReport = { reveals: [["a", "2026-10-27", 2], ["b", "2026-10-27", 1], ["c", "2026-10-27", 4]], visits: [["a", "2026-10-26", 1]] };
    const r = buildReport({
      raw, days: 7, today: "2026-10-27", listings,
      members: [{ userId: "u1", name: "Amira" }, { userId: "u2", name: "Bilel" }, { userId: "u3", name: "Chokri" }],
      byAgent: true, tracesKeptDays: 365,
    });
    expect(r.agents.map((a) => [a.name, a.listings, a.reveals, a.visits])).toEqual([
      ["Bilel", 1, 4, 0],
      ["Amira", 1, 3, 1],
      ["Chokri", 0, 0, 0],
    ]);
  });

  it("no agent table for an agent's own report", () => {
    const r = buildReport({ raw: {}, days: 7, today: "2026-10-27", listings: [L("a", "u1")], members: [{ userId: "u1", name: "x" }], byAgent: false, tracesKeptDays: 0 });
    expect(r.agents).toEqual([]);
  });

  it("compares only when the period before is still kept", () => {
    expect(canCompare(90, 365)).toBe(true);
    expect(canCompare(90, 90)).toBe(false);
    expect(canCompare(30, 90)).toBe(true);
    expect(canCompare(90, 0)).toBe(true);
    const r = buildReport({ raw: {}, days: 90, today: "2026-10-27", listings: [], members: [], byAgent: false, tracesKeptDays: 90 });
    expect(r.previous).toBeNull();
  });

  it("says the change in whole percent, nothing when there was nothing before", () => {
    expect(change(15, 10)).toBe(50);
    expect(change(5, 10)).toBe(-50);
    expect(change(3, 0)).toBeNull();
    expect(change(0, 4)).toBe(-100);
  });

  it("writes a spreadsheet Excel reads: BOM, `;`, quotes doubled", () => {
    const r = buildReport({ raw: { visitors: [["a", "2026-10-27", 3]] }, days: 7, today: "2026-10-27", listings: [L("a", "u", "published", 'Villa "S+4" à Sfax')], members: [], byAgent: false, tracesKeptDays: 0 });
    const csv = reportCsv(r, { reference: "Réf", title: "Annonce", visitors: "V", reveals: "N", favourites: "F", visits: "Vi", leads: "C" });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [head, line] = csv.slice(1).split("\r\n");
    expect(head).toBe('"Réf";"Annonce";"V";"N";"F";"Vi";"C"');
    expect(line).toBe('"MZ-a";"Villa ""S+4"" à Sfax";"3";"0";"0";"0";"0"');
  });

  it("keeps a title that starts like a formula as text (spreadsheet injection)", () => {
    const listings = [
      L("a", "u", "published", '=HYPERLINK("http://evil.example","clic")'),
      L("b", "u", "published", "-20 % cette semaine"),
      L("c", "u", "published", "Villa +4 à Sfax"),
    ];
    const raw: RawReport = { visitors: [["a", "2026-10-27", 3], ["b", "2026-10-27", 2], ["c", "2026-10-27", 1]] };
    const r = buildReport({ raw, days: 7, today: "2026-10-27", listings, members: [], byAgent: false, tracesKeptDays: 0 });
    const lines = reportCsv(r, { reference: "Réf", title: "Annonce", visitors: "V", reveals: "N", favourites: "F", visits: "Vi", leads: "C" }).slice(1).split("\r\n");
    expect(lines[1]).toBe('"MZ-a";"\'=HYPERLINK(""http://evil.example"",""clic"")";"3";"0";"0";"0";"0"');
    expect(lines[2]).toBe('"MZ-b";"\'-20 % cette semaine";"2";"0";"0";"0";"0"');
    // A sign inside the text is not a formula.
    expect(lines[3]).toBe('"MZ-c";"Villa +4 à Sfax";"1";"0";"0";"0";"0"');
  });
});
