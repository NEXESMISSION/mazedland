import { describe, it, expect } from "vitest";
import { understand, understoodSomething } from "./understand";

describe("understand — French", () => {
  it("reads rooms, furnished, rent, place and a monthly budget", () => {
    expect(understand("S+2 meublé à louer Tunis 1200 dt")).toEqual({
      rooms: 2,
      furnished: "furnished",
      deal: "rent",
      gov: "Tunis",
      max: 1200,
      rest: "",
    });
  });

  it("reads « mille », a category and a ceiling", () => {
    expect(understand("villa nabeul moins de 800 mille")).toMatchObject({ cat: "villas", gov: "Nabeul", max: 800_000 });
  });

  it("reads a range and a surface", () => {
    const u = understand("terrain sfax 500 m2 entre 100 et 200 mille");
    expect(u).toMatchObject({ cat: "terrain", gov: "Sfax", surface: 500, min: 100_000, max: 200_000 });
  });

  it("reads a délégation, and finds its governorate", () => {
    expect(understand("appartement la marsa vue mer")).toEqual({ cat: "appartements", gov: "Tunis", del: "La Marsa", rest: "vue mer" });
    expect(understand("شقة في المرسى")).toMatchObject({ cat: "appartements", gov: "Tunis", del: "La Marsa" });
    expect(understand("villa hammamet nabeul")).toMatchObject({ cat: "villas", gov: "Nabeul", del: "Hammamet" });
    expect(understand("local msaken")).toMatchObject({ gov: "Sousse", del: "M'saken" });
    expect(understand("terrain sfax ville")).toMatchObject({ gov: "Sfax", del: "Sfax Ville" });
  });

  it("keeps a district that is not a délégation as a keyword", () => {
    expect(understand("appartement ennasr")).toEqual({ cat: "appartements", gov: "Ariana", rest: "ennasr" });
  });

  it("reads a governorate named like one of its délégations as the governorate", () => {
    expect(understand("villa nabeul")).toEqual({ cat: "villas", gov: "Nabeul", rest: "" });
    expect(understand("ezzouhour kasserine")).toMatchObject({ gov: "Kasserine", del: "Ezzouhour" });
  });

  it("does not take a common word for a place", () => {
    expect(understand("شقة في المدينة")).not.toHaveProperty("del");
  });

  it("does not read « non meublé » as furnished", () => {
    expect(understand("studio non meublé ariana")).toMatchObject({ cat: "appartements", furnished: "unfurnished", gov: "Ariana" });
  });

  it("reads a Latin « million » the Tunisian way when dinars would be absurd", () => {
    expect(understand("maison 300 million").max).toBe(300_000);
    expect(understand("villa 1.2 million").max).toBe(1_200_000);
  });

  it("does not take a year or a phone number for a budget", () => {
    expect(understand("villa construite 2020").max).toBeUndefined();
    expect(understand("appartement 98124111").max).toBeUndefined();
    expect(understand("S+1 1200").max).toBe(1200);
  });

  it("reads rooms written out and a surface glued to its unit", () => {
    expect(understand("appartement 120m2 3 chambres")).toMatchObject({ cat: "appartements", surface: 120, rooms: 3 });
  });

  it("leaves a plain keyword alone", () => {
    const u = understand("piscine");
    expect(u.rest).toBe("piscine");
    expect(understoodSomething(u)).toBe(false);
  });
});

describe("understand — Arabic and Derja", () => {
  it("reads « مليون » as a thousand dinars", () => {
    expect(understand("أرض صفاقس 300 مليون")).toMatchObject({ cat: "terrain", gov: "Sfax", max: 300_000 });
  });

  it("reads rent, rooms and furnished", () => {
    expect(understand("شقة للكراء 3 بيوت مفروشة سوسة")).toMatchObject({ deal: "rent", cat: "appartements", rooms: 3, furnished: "furnished", gov: "Sousse" });
  });

  it("reads « مليار » as a million dinars and Eastern digits", () => {
    expect(understand("فيلا ١ مليار").max).toBe(1_000_000);
  });

  it("reads a final ة typed as ه, in a category and in a place", () => {
    expect(understand("شقه في سوسة")).toEqual({ cat: "appartements", gov: "Sousse", rest: "" });
    expect(understand("مزرعه جندوبه")).toEqual({ cat: "fermes", gov: "Jendouba", rest: "" });
    expect(understand("دار اريانه")).toMatchObject({ cat: "maisons", gov: "Ariana" });
  });

  it("reads a preposition attached to the figure, and the rent period", () => {
    expect(understand("فيلا بـ800 ألف")).toEqual({ cat: "villas", max: 800_000, rest: "" });
    expect(understand("شقة للكراء سوسة 700 دينار في الشهر")).toEqual({ deal: "rent", cat: "appartements", gov: "Sousse", max: 700, rest: "" });
    expect(understand("شقة للايجار تونس")).toMatchObject({ deal: "rent", cat: "appartements", gov: "Tunis" });
  });

  it("reads the bounds said in Arabic", () => {
    expect(understand("فيلا على الأقل 300 ألف")).toEqual({ cat: "villas", min: 300_000, rest: "" });
    expect(understand("فيلا من 300 ألف")).toEqual({ cat: "villas", min: 300_000, rest: "" });
    expect(understand("فيلا موش أكثر من 300 ألف")).toEqual({ cat: "villas", max: 300_000, rest: "" });
  });
});

describe("understand — figures written the French way", () => {
  it("reads digits grouped by three as one figure", () => {
    expect(understand("appartement S+2 à Sfax moins de 300 000")).toEqual({ cat: "appartements", gov: "Sfax", rooms: 2, max: 300_000, rest: "" });
    expect(understand("villa 350 000").max).toBe(350_000);
    expect(understand("villa 1 200 000").max).toBe(1_200_000);
    expect(understand("terrain sfax 150 000 dt")).toMatchObject({ cat: "terrain", gov: "Sfax", max: 150_000 });
    expect(understand("appartement a louer tunis 1 200 dt")).toMatchObject({ deal: "rent", gov: "Tunis", max: 1200 });
    expect(understand("maison 250.000 dt sfax")).toMatchObject({ cat: "maisons", gov: "Sfax", max: 250_000 });
    expect(understand("villa 350.000 dt").max).toBe(350_000);
    // A no-break space, as dictation and the site's own prices write it.
    expect(understand("villa 300 000").max).toBe(300_000);
  });

  it("keeps a decimal comma", () => {
    expect(understand("appartement sousse 1,5 million")).toEqual({ cat: "appartements", gov: "Sousse", max: 1_500_000, rest: "" });
  });

  it("does not join a rooms count to the budget", () => {
    expect(understand("S 2 300 000")).toEqual({ rooms: 2, max: 300_000, rest: "" });
  });
});

describe("understand — the words around a figure", () => {
  it("reads a minimum however it is said", () => {
    for (const q of ["villa au moins 300 mille", "villa 300 mille minimum", "villa au dessus de 300 mille", "villa pas moins de 300 mille", "villa a partir de 300 mille", "villa 300 mille et plus"]) {
      expect(understand(q), q).toEqual({ cat: "villas", min: 300_000, rest: "" });
    }
  });

  it("reads a maximum however it is said", () => {
    for (const q of ["villa pas plus de 300 mille", "villa au plus 300 mille", "villa 300 mille maximum", "villa en dessous de 300 mille", "villa jusqu'à 300 mille", "villa 300 mille max"]) {
      expect(understand(q), q).toEqual({ cat: "villas", max: 300_000, rest: "" });
    }
  });

  it("reads a floor and a ceiling said together, and a range with a dash", () => {
    expect(understand("villa plus de 100 mille moins de 200 mille")).toMatchObject({ min: 100_000, max: 200_000 });
    expect(understand("villa 300-400 mille")).toEqual({ cat: "villas", min: 300_000, max: 400_000, rest: "" });
    expect(understand("villa 300 à 400 mille")).toMatchObject({ min: 300_000, max: 400_000 });
  });

  it("never leaves the words of a bound as keywords", () => {
    expect(understand("appartement moins de 200").rest).toBe("");
  });
});

describe("understand — rooms and rent periods", () => {
  it("reads « S 2 » and « S2 », the way a + reaches the server from a plain link", () => {
    expect(understand("S 2 tunis")).toEqual({ rooms: 2, gov: "Tunis", rest: "" });
    expect(understand("s2 tunis")).toMatchObject({ rooms: 2 });
    expect(understand("s plus 2 tunis")).toMatchObject({ rooms: 2 });
  });

  it("counts « 3 pièces » as an S+2, and « 3 chambres » as three", () => {
    expect(understand("appartement 3 pièces la marsa")).toMatchObject({ rooms: 2, del: "La Marsa" });
    expect(understand("appartement S+2 tunis 3 pièces")).toEqual({ cat: "appartements", gov: "Tunis", rooms: 2, rest: "" });
    expect(understand("appartement 3 chambres").rooms).toBe(3);
  });

  it("reads a rent period as « to rent », never as a keyword", () => {
    expect(understand("appartement a louer sousse 700 dt par mois")).toEqual({ deal: "rent", cat: "appartements", gov: "Sousse", max: 700, rest: "" });
    expect(understand("studio tunis 600 dt/mois")).toEqual({ deal: "rent", cat: "appartements", gov: "Tunis", max: 600, rest: "" });
  });

  it("reads Latin Derja money", () => {
    expect(understand("dar sousse 250 alf")).toEqual({ cat: "maisons", gov: "Sousse", max: 250_000, rest: "" });
    expect(understand("villa 400 mlyoun").max).toBe(400_000);
  });
});
