import { describe, expect, it } from "vitest";
import { catalogueRedirect, pastEndRedirect } from "./redirects";

const on = { arabicRedirect: true, naturalSearch: true };
const off = { arabicRedirect: false, naturalSearch: false };
const leaves = [
  { id: "5e3c2b1a-0000-4000-8000-000000000001", slug: "appartements" },
  { id: "5e3c2b1a-0000-4000-8000-000000000002", slug: "villas" },
];

describe("catalogueRedirect", () => {
  it("drops the search box's marker and the page, and keeps the rest", () => {
    expect(catalogueRedirect({ via: "search", q: "villa", gov: "Sfax", page: "3" }, "fr", on, leaves)).toBe(
      "/fr/annonces?q=villa&gov=Sfax",
    );
  });

  it("sends Arabic typed on the French site to /ar, unless the switch is off", () => {
    expect(catalogueRedirect({ via: "search", q: "فيلا للبيع" }, "fr", on, leaves)).toBe("/ar/annonces?q=%D9%81%D9%8A%D9%84%D8%A7+%D9%84%D9%84%D8%A8%D9%8A%D8%B9");
    expect(catalogueRedirect({ via: "search", q: "فيلا للبيع" }, "fr", off, leaves)).toBe("/fr/annonces?q=%D9%81%D9%8A%D9%84%D8%A7+%D9%84%D9%84%D8%A8%D9%8A%D8%B9");
    expect(catalogueRedirect({ via: "search", q: "فيلا" }, "ar", on, leaves)).toBe("/ar/annonces?q=%D9%81%D9%8A%D9%84%D8%A7");
  });

  it("turns a search typed the way people talk into filters, once", () => {
    const target = catalogueRedirect({ q: "villa à vendre Sfax" }, "fr", on, leaves);
    expect(target).not.toBeNull();
    const u = new URL(target as string, "https://x");
    expect(u.pathname).toBe("/fr/annonces");
    expect(u.searchParams.get("deal")).toBe("sale");
    expect(u.searchParams.get("cat")).toBe("villas");
    expect(u.searchParams.get("gov")).toBe("Sfax");
    expect(u.searchParams.get("nlq")).toBe("villa à vendre Sfax");
    // Already read, asked as typed, or the switch off: the words stay a keyword.
    expect(catalogueRedirect({ q: "villa à vendre Sfax", nlq: "villa à vendre Sfax" }, "fr", on, leaves)).toBeNull();
    expect(catalogueRedirect({ q: "villa à vendre Sfax", nl: "0" }, "fr", on, leaves)).toBeNull();
    expect(catalogueRedirect({ q: "villa à vendre Sfax" }, "fr", off, leaves)).toBeNull();
  });

  it("writes a category named by its id with its slug", () => {
    expect(catalogueRedirect({ cat: leaves[0].id, gov: "Tunis" }, "fr", on, leaves)).toBe("/fr/annonces?cat=appartements&gov=Tunis");
    expect(catalogueRedirect({ cat: "appartements", gov: "Tunis" }, "fr", on, leaves)).toBeNull();
    expect(catalogueRedirect({ cat: "chateaux" }, "fr", on, leaves)).toBeNull();
    expect(catalogueRedirect({ cat: leaves[0].id }, "fr", on, [])).toBeNull();
  });

  it("stays for a plain landing page", () => {
    expect(catalogueRedirect({}, "fr", on, leaves)).toBeNull();
    expect(catalogueRedirect({ deal: "rent", gov: "Sfax", page: "2" }, "ar", on, leaves)).toBeNull();
  });
});

describe("pastEndRedirect", () => {
  it("sends a page past the last one to the first, keeping the search", () => {
    expect(pastEndRedirect({ gov: "Sfax", page: "2" }, "fr", 2, 11, 24)).toBe("/fr/annonces?gov=Sfax");
    expect(pastEndRedirect({ page: "9999" }, "ar", 9999, 11, 24)).toBe("/ar/annonces");
  });

  it("leaves a page that exists, the first page, and an empty catalogue's first page", () => {
    expect(pastEndRedirect({ page: "2" }, "fr", 2, 25, 24)).toBeNull();
    expect(pastEndRedirect({ page: "1" }, "fr", 1, 0, 24)).toBeNull();
    expect(pastEndRedirect({}, "fr", 1, 11, 24)).toBeNull();
  });
});
