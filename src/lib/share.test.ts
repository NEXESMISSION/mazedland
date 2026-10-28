import { describe, expect, it } from "vitest";
import { shareLinks, shareText } from "./share";

describe("share", () => {
  it("WhatsApp gets the words and the link, Facebook the link alone", () => {
    const { whatsapp, facebook } = shareLinks("Villa S+3 · 450 000 DT · Sfax", "https://www.mazed.immo/fr/annonces/abc");
    expect(whatsapp).toBe("https://wa.me/?text=Villa%20S%2B3%20%C2%B7%20450%20000%20DT%20%C2%B7%20Sfax%20https%3A%2F%2Fwww.mazed.immo%2Ffr%2Fannonces%2Fabc");
    expect(facebook).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fwww.mazed.immo%2Ffr%2Fannonces%2Fabc");
  });

  it("the words: title, price and place when there are some, nothing empty between dots", () => {
    expect(shareText({ title: "Villa S+3", price: "450 000 DT", place: "Sfax" })).toBe("Villa S+3 · 450 000 DT · Sfax");
    expect(shareText({ title: "Terrain", price: null, place: " Sousse " })).toBe("Terrain · Sousse");
    expect(shareText({ title: "Appartement" })).toBe("Appartement");
  });
});
