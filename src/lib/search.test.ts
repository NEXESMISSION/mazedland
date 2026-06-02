import { describe, it, expect } from "vitest";
import { normalizeSearchQuery, buildIlikeOrClause, PROPERTY_SEARCH_FIELDS, stripAccents } from "./search";

describe("normalizeSearchQuery", () => {
  it("trims and collapses interior whitespace", () => {
    expect(normalizeSearchQuery("  Sfax   apartment ")).toBe("Sfax apartment");
  });
  it("strips PostgREST/ilike special characters that could break or() or act as wildcards", () => {
    expect(normalizeSearchQuery("sfax,apartment")).toBe("sfaxapartment");
    expect(normalizeSearchQuery("50%_off (deal)")).toBe("50off deal");
    expect(normalizeSearchQuery('a"b\\c')).toBe("abc");
  });
  it("returns empty string for nullish input", () => {
    expect(normalizeSearchQuery(null)).toBe("");
    expect(normalizeSearchQuery(undefined)).toBe("");
    expect(normalizeSearchQuery("")).toBe("");
  });
});

describe("buildIlikeOrClause", () => {
  it("emits one ilike per field, comma-joined", () => {
    expect(buildIlikeOrClause("sfax", ["title", "address"])).toBe(
      "title.ilike.%sfax%,address.ilike.%sfax%",
    );
  });
  it("covers every documented property search field", () => {
    const clause = buildIlikeOrClause("x", PROPERTY_SEARCH_FIELDS);
    expect(clause.split(",")).toHaveLength(PROPERTY_SEARCH_FIELDS.length);
    expect(clause).toContain("governorate.ilike.%x%");
  });
});

describe("stripAccents", () => {
  it("folds French/Latin diacritics and lower-cases (mirrors f_unaccent)", () => {
    expect(stripAccents("Béja")).toBe("beja");
    expect(stripAccents("Médenine")).toBe("medenine");
    expect(stripAccents("Résidentiel Orienté")).toBe("residentiel oriente");
  });
  it("leaves non-Latin scripts (Arabic) untouched", () => {
    expect(stripAccents("صفاقس")).toBe("صفاقس");
  });
  it("returns empty string for nullish input", () => {
    expect(stripAccents(null)).toBe("");
    expect(stripAccents(undefined)).toBe("");
    expect(stripAccents("")).toBe("");
  });
});
