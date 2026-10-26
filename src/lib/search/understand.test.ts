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
});
