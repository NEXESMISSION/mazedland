import { describe, expect, it } from "vitest";
import { catalogueIndexing, catalogueLandings, clip, itemListLd, listingDescription, organizationLd, pageAlternates, websiteLd } from "./seo";
import { jsonLdSafe } from "./jsonld";

describe("seo", () => {
  it("names the page itself and its twin, never the home page", () => {
    expect(pageAlternates("ar", "/annonces", "cat=terrains&gov=Sfax")).toEqual({
      canonical: "/ar/annonces?cat=terrains&gov=Sfax",
      languages: { fr: "/fr/annonces?cat=terrains&gov=Sfax", ar: "/ar/annonces?cat=terrains&gov=Sfax", "x-default": "/fr/annonces?cat=terrains&gov=Sfax" },
    });
    expect(pageAlternates("fr", "").canonical).toBe("/fr");
  });

  it("indexes a city, a type, sale or rent, and their pages", () => {
    expect(catalogueIndexing({ cat: "appartements", gov: "Sfax" })).toEqual({ query: "cat=appartements&gov=Sfax", index: true });
    expect(catalogueIndexing({ gov: "Sfax", deal: "rent", page: "2" })).toEqual({ query: "deal=rent&gov=Sfax&page=2", index: true });
    expect(catalogueIndexing({ gov: "Sfax", del: "Sakiet Ezzit" })).toEqual({ query: "gov=Sfax&del=Sakiet+Ezzit", index: true });
    expect(catalogueIndexing({}).query).toBe("");
  });

  it("a keyword, a budget or a sort is a results page: followed, not indexed, canonical to its landing page", () => {
    expect(catalogueIndexing({ cat: "villas", q: "piscine" })).toEqual({ query: "cat=villas", index: false });
    expect(catalogueIndexing({ gov: "Tunis", max: "300000" })).toEqual({ query: "gov=Tunis", index: false });
    expect(catalogueIndexing({ gov: "Tunis", sort: "price_asc" }).index).toBe(false);
  });

  it("ignores what says nothing about the results, and drops what is not a filter", () => {
    expect(catalogueIndexing({ gov: "Sousse", via: "search", utm_source: "fb" })).toEqual({ query: "gov=Sousse", index: true });
    expect(catalogueIndexing({ deal: "all", page: "1", del: "El Ain" })).toEqual({ query: "", index: true });
    expect(catalogueIndexing({ page: "abc" }).query).toBe("");
  });

  it("lists every landing page that holds an annonce, written like the canonical", () => {
    const pages = catalogueLandings([
      { deal: "rent", cat: "appartements", gov: "Sfax" },
      { deal: "sale", cat: "terrains", gov: "Sfax" },
    ]);
    expect(pages).toContain("gov=Sfax");
    expect(pages).toContain("cat=appartements&gov=Sfax");
    expect(pages).toContain("deal=rent&cat=appartements&gov=Sfax");
    expect(pages).toContain("deal=sale");
    expect(pages).not.toContain("deal=sale&cat=appartements");
    expect(pages).not.toContain("");
    for (const q of pages) {
      const sp = Object.fromEntries(new URLSearchParams(q));
      expect(catalogueIndexing(sp).query, q).toBe(q);
    }
  });

  it("cuts a snippet at a word, with an ellipsis", () => {
    expect(clip("court")).toBe("court");
    const long = "Villa avec piscine ".repeat(20);
    const c = clip(long, 60);
    expect(c.length).toBeLessThanOrEqual(60);
    expect(c.endsWith("…")).toBe(true);
    expect(c).not.toMatch(/ …$/);
  });

  it("lets the facts lead when the seller wrote one word", () => {
    expect(listingDescription("ممتاز", "Appartement · 208 m² · S+4 · Sfax · Prix sur demande")).toBe(
      "Appartement · 208 m² · S+4 · Sfax · Prix sur demande. ممتاز",
    );
    expect(listingDescription(null, "Terrain · Sfax.")).toBe("Terrain · Sfax.");
    const real = "Bel appartement lumineux au 3e étage, cuisine équipée, deux salles d'eau, proche des écoles et du centre.";
    expect(listingDescription(real, "facts")).toBe(real);
  });

  it("offers Google the site's search, and how to reach the company", () => {
    const w = websiteLd("https://www.mazed.immo", "ar", "Mazed Immo");
    expect(w.potentialAction.target.urlTemplate).toBe("https://www.mazed.immo/ar/annonces?q={search_term_string}");
    const o = organizationLd("https://www.mazed.immo", "Mazed Immo", { whatsapp: "+216 58 415 521" });
    expect(o.contactPoint?.[0].telephone).toBe("+21658415521");
    expect(organizationLd("https://x", "M", {}).contactPoint).toBeUndefined();
    expect(itemListLd(["a", "b"]).itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, url: "b" });
  });

  it("structured data never closes its own script tag", () => {
    const out = jsonLdSafe({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});
