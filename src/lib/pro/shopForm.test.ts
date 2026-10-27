import { describe, it, expect } from "vitest";
import { frAt, phoneForField, readableEmail, shopPlace, shopPresentation, slugPreview, typedSlug } from "./shopForm";
import { slugify } from "./shops";

describe("slugPreview", () => {
  it("shows the address the server will make from a Latin name", () => {
    expect(slugPreview("Agence Él Médina — Sfax")).toBe("agence-el-medina-sfax");
    expect(slugPreview("Agence Él Médina — Sfax")).toBe(slugify("Agence Él Médina — Sfax", "abcd"));
  });
  it("says the suffix is to come when the name has no Latin letters", () => {
    expect(slugPreview("وكالة الأمان")).toBe("agence-…");
    expect(slugPreview("")).toBe("agence-…");
  });
});

describe("typedSlug", () => {
  it("keeps what a slug may hold, as it is typed", () => {
    expect(typedSlug("Agence El Médina")).toBe("agence-el-medina");
    expect(typedSlug("agence-")).toBe("agence-");
    expect(typedSlug("--agence__sfax")).toBe("agence-sfax");
    expect(typedSlug("a".repeat(80))).toHaveLength(60);
  });
});

describe("readableEmail", () => {
  it("drops the synthetic address of a phone account", () => {
    expect(readableEmail("21622123456@phone.mazedland.app", "phone.mazedland.app")).toBe("");
    expect(readableEmail("21622123456@PHONE.mazedland.app", "phone.mazedland.app")).toBe("");
  });
  it("keeps a real one", () => {
    expect(readableEmail(" contact@agence.tn ", "phone.mazedland.app")).toBe("contact@agence.tn");
    expect(readableEmail(null, "phone.mazedland.app")).toBe("");
  });
});

describe("phoneForField", () => {
  it("spaces a Tunisian number the way it is written", () => {
    expect(phoneForField("+21622123456")).toBe("+216 22 123 456");
  });
  it("leaves anything else as stored", () => {
    expect(phoneForField("+33612345678")).toBe("+33612345678");
    expect(phoneForField(null)).toBe("");
  });
});

describe("frAt", () => {
  it("contracts the article of « Le Bardo »", () => {
    expect(frAt("Le Bardo, Tunis")).toBe("au Bardo, Tunis");
    expect(frAt("Les Berges")).toBe("aux Berges");
    expect(frAt("La Marsa, Tunis")).toBe("à La Marsa, Tunis");
    expect(frAt("Sfax")).toBe("à Sfax");
  });
});

describe("shopPlace", () => {
  it("names the délégation and its governorate in the reader's language", () => {
    expect(shopPlace("Tunis", "La Marsa", "fr")).toBe("La Marsa, Tunis");
    expect(shopPlace("Tunis", "La Marsa", "ar")).toBe("المرسى، تونس");
  });
  it("says a shared name once, and a typed city as typed", () => {
    expect(shopPlace("Monastir", "Monastir", "fr")).toBe("Monastir");
    expect(shopPlace("Sfax", "Route de Teniour", "fr")).toBe("Route de Teniour, Sfax");
    expect(shopPlace("Sfax", "", "fr")).toBe("Sfax");
    expect(shopPlace("", "", "fr")).toBe("");
  });
});

describe("shopPresentation", () => {
  it("writes from the kind, the name and the place, in French", () => {
    const text = shopPresentation({ kind: "agency", name: "  Agence  El Amen ", governorate: "Tunis", city: "Le Bardo" }, "fr");
    expect(text.startsWith("Bienvenue chez Agence El Amen, agence immobilière au Bardo, Tunis.")).toBe(true);
  });
  it("writes in Arabic on an Arabic page, opening on an Arabic word", () => {
    const text = shopPresentation({ kind: "promoter", name: "Immo Plus", governorate: "Sousse", city: "" }, "ar");
    expect(text.startsWith("مرحبا بيكم في Immo Plus، باعث عقاري في سوسة.")).toBe(true);
  });
  it("leaves the place out when there is none", () => {
    expect(shopPresentation({ kind: "land_developer", name: "Lots du Sud", governorate: "", city: "" }, "fr")).toMatch(
      /^Bienvenue chez Lots du Sud, lotisseur\. /,
    );
  });
  it("has a text for every kind in both languages", () => {
    for (const kind of ["agency", "promoter", "land_developer", "property_manager"] as const) {
      for (const locale of ["fr", "ar"]) {
        const text = shopPresentation({ kind, name: "X Immo", governorate: "Sfax", city: "" }, locale);
        expect(text).toContain("X Immo");
        expect(text.length).toBeLessThan(400);
      }
    }
  });
});
