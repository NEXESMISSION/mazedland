import { describe, it, expect } from "vitest";
import { normalizeGroupUrl, parseGroupInput } from "./groups";
import { groupsFor, orderedPhotos, type GroupRow } from "./server";

describe("normalizeGroupUrl", () => {
  it("keeps the group and drops the rest", () => {
    expect(normalizeGroupUrl("https://m.facebook.com/groups/immobilier.sfax/?ref=share")).toBe(
      "https://www.facebook.com/groups/immobilier.sfax",
    );
    expect(normalizeGroupUrl("https://www.facebook.com/groups/123456789/posts/42")).toBe(
      "https://www.facebook.com/groups/123456789",
    );
  });
  it("refuses what is not a Facebook group", () => {
    expect(normalizeGroupUrl("https://www.facebook.com/MazedImmo")).toBeNull();
    expect(normalizeGroupUrl("https://evil.example/groups/x")).toBeNull();
    expect(normalizeGroupUrl("not a url")).toBeNull();
  });
});

describe("parseGroupInput", () => {
  it("keeps only known governorates, deals and kinds", () => {
    const r = parseGroupInput({
      name: "  Immobilier   Sfax ",
      url: "https://www.facebook.com/groups/immo.sfax",
      governorates: ["Sfax", "Atlantis"],
      deal_types: ["sale", "swap"],
      category_kinds: ["land", "boats"],
      members: "12500",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Immobilier Sfax",
        url: "https://www.facebook.com/groups/immo.sfax",
        governorates: ["Sfax"],
        deal_types: ["sale"],
        category_kinds: ["land"],
        members: 12500,
        allows_links: true,
        rules: null,
      },
    });
  });
  it("needs a name, a group link and at least one deal", () => {
    expect(parseGroupInput({ name: "x", url: "https://www.facebook.com/groups/a", deal_types: ["sale"] })).toMatchObject({ ok: false, error: "name" });
    expect(parseGroupInput({ name: "Immo", url: "https://example.com", deal_types: ["sale"] })).toMatchObject({ ok: false, error: "url" });
    expect(parseGroupInput({ name: "Immo", url: "https://www.facebook.com/groups/a", deal_types: [] })).toMatchObject({ ok: false, error: "deal_types" });
  });
});

describe("groupsFor", () => {
  const g = (over: Partial<GroupRow>): GroupRow => ({
    id: "g", name: "G", url: "https://www.facebook.com/groups/g", governorates: [], deal_types: ["sale", "rent"],
    category_kinds: [], allows_links: true, status: "active", members: null, rules: null, last_shared_at: null, ...over,
  });

  it("picks the active groups for the annonce's deal, place and kind", () => {
    const groups = [
      g({ id: "all" }),
      g({ id: "sfax", governorates: ["Sfax"] }),
      g({ id: "tunis", governorates: ["Tunis"] }),
      g({ id: "rent-only", deal_types: ["rent"] }),
      g({ id: "land", category_kinds: ["land"] }),
      g({ id: "paused", status: "paused" }),
    ];
    const ids = groupsFor(groups, { dealType: "sale", governorate: "Sfax", kind: "residential" }).map((x) => x.id);
    expect(ids).toEqual(["all", "sfax"]);
  });
});

describe("orderedPhotos", () => {
  it("puts the cover first, then the seller's order", () => {
    expect(
      orderedPhotos([
        { storage_path: "c", sort_order: 2 },
        { storage_path: "a", sort_order: 0 },
        { storage_path: "b", sort_order: 1, is_cover: true },
      ]),
    ).toEqual(["b", "a", "c"]);
  });
});
