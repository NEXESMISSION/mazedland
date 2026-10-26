import { describe, it, expect } from "vitest";
import { TUNISIAN_GOVERNORATES } from "./tunisia";
import { DELEGATIONS, canonicalDelegation, delegationLabel, delegationsOf, governorateOfDelegation, placeKey, shownDelegation } from "./delegations";

describe("the délégations", () => {
  it("are the 264 of the 24 governorates", () => {
    const counts = Object.fromEntries(TUNISIAN_GOVERNORATES.map((g) => [g, DELEGATIONS[g].length]));
    expect(counts).toEqual({
      Tunis: 21, Ariana: 7, "Ben Arous": 12, Manouba: 8, Sousse: 16, Monastir: 13, Mahdia: 11, Nabeul: 16,
      Sfax: 16, Bizerte: 14, Gabès: 10, Médenine: 9, Kairouan: 11, Béja: 9, Jendouba: 9, Kef: 11,
      Kasserine: 13, "Sidi Bouzid": 12, Gafsa: 11, Tozeur: 5, Kebili: 6, Tataouine: 7, Siliana: 11, Zaghouan: 6,
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(264);
  });

  it("are each named once in a governorate, in both languages", () => {
    for (const g of TUNISIAN_GOVERNORATES) {
      const fr = DELEGATIONS[g].map(([f]) => placeKey(f));
      const ar = DELEGATIONS[g].map(([, a]) => a);
      expect(new Set(fr).size, g).toBe(fr.length);
      expect(new Set(ar).size, g).toBe(ar.length);
      for (const a of ar) expect(a, `${g}: ${a}`).toMatch(/^[؀-ۿ ]+$/);
    }
  });

  it("lists a governorate's délégations, nothing for an unknown one", () => {
    expect(delegationsOf("Ariana")).toContain("La Soukra");
    expect(delegationsOf("Ariana")).not.toContain("La Marsa");
    expect(delegationsOf("Atlantis")).toEqual([]);
    expect(delegationsOf(null)).toEqual([]);
  });

  it("recognises a délégation typed by hand", () => {
    expect(canonicalDelegation("Tunis", "la marsa")).toBe("La Marsa");
    expect(canonicalDelegation("Tunis", "LA MARSA ")).toBe("La Marsa");
    expect(canonicalDelegation("Sousse", "msaken")).toBe("M'saken");
    expect(canonicalDelegation("Sousse", "M'saken")).toBe("M'saken");
    expect(canonicalDelegation("Tunis", "المرسى")).toBe("La Marsa");
    expect(canonicalDelegation("Ariana", "La Marsa")).toBe(null); // not in that governorate
    expect(canonicalDelegation("Ariana", "Ennasr")).toBe(null); // a neighbourhood, not a délégation
  });

  it("says a délégation in the reader's language, and keeps one off the list as typed", () => {
    expect(delegationLabel("La Marsa", "ar")).toBe("المرسى");
    expect(delegationLabel("la marsa", "fr")).toBe("La Marsa");
    expect(delegationLabel("Ennasr", "ar")).toBe("Ennasr");
    expect(delegationLabel(null, "fr")).toBe("");
  });

  it("finds the governorate of a délégation", () => {
    expect(governorateOfDelegation("Hammamet")).toBe("Nabeul");
    expect(governorateOfDelegation("djerba midoun")).toBe("Médenine");
    expect(governorateOfDelegation("Ennasr")).toBe(null);
  });
  it("shows only a listed délégation beside a place", () => {
    expect(shownDelegation("Sfax", "sakiet ezzit", "ar")).toBe("ساقية الزيت");
    expect(shownDelegation("Sfax", "sfax", "fr")).toBeNull();
    expect(shownDelegation("Sfax", "alain", "fr")).toBeNull();
    expect(shownDelegation("Tunis", "Sakiet Ezzit", "fr")).toBeNull();
  });
});
