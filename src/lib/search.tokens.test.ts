import { describe, it, expect } from "vitest";
import { searchTokens } from "./search";

describe("searchTokens", () => {
  it("folds accents the way search_text is stored", () => {
    expect(searchTokens("bâtir")).toEqual(["batir"]);
    expect(searchTokens("Béja")).toEqual(["beja"]);
    expect(searchTokens("gros œuvre")).toEqual(["gros", "oeuvre"]);
  });

  it("splits into words so every word has to match", () => {
    expect(searchTokens("terrain sfax")).toEqual(["terrain", "sfax"]);
    expect(searchTokens("centre-ville")).toEqual(["centre", "ville"]);
    expect(searchTokens("  terrain   à   vendre ")).toEqual(["terrain", "a", "vendre"]);
  });

  it("drops duplicates, wildcards and empty input", () => {
    expect(searchTokens("sfax sfax")).toEqual(["sfax"]);
    expect(searchTokens("100%_terrain")).toEqual(["100terrain"]);
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens(null)).toEqual([]);
  });

  it("keeps at most six words", () => {
    expect(searchTokens("un deux trois quatre cinq six sept huit")).toHaveLength(6);
  });
});
