import { describe, it, expect } from "vitest";
import { addPhrase, hasPhrase, removePhrase, swapPhrase, togglePhrase } from "./phrases";

describe("addPhrase", () => {
  it("joins short phrases with a comma, the Arabic comma in Arabic", () => {
    expect(addPhrase("", "Vue mer")).toBe("Vue mer");
    expect(addPhrase("Vue mer", "Avec parking")).toBe("Vue mer, Avec parking");
    expect(addPhrase("Teniour  ", "Vue mer")).toBe("Teniour, Vue mer");
    expect(addPhrase("طابق أرضي", "فيها باركينغ")).toBe("طابق أرضي، فيها باركينغ");
  });

  it("joins sentences with a space, ending the text first when it was not", () => {
    const hello = "Bonjour, votre annonce m'intéresse. Je souhaite la visiter.";
    expect(addPhrase(hello, "Financement prêt.")).toBe(`${hello} Financement prêt.`);
    expect(addPhrase("Bonjour", "Financement prêt.")).toBe("Bonjour. Financement prêt.");
    expect(addPhrase("Vue mer,", "Meublé")).toBe("Vue mer, Meublé");
  });

  it("adds nothing twice, whatever the case, and never past the limit", () => {
    expect(addPhrase("vue mer", "Vue mer")).toBe("vue mer");
    expect(addPhrase("abc", "Vue mer", 8)).toBe("abc");
    expect(addPhrase("abc", "Vue mer", 12)).toBe("abc, Vue mer");
    expect(addPhrase("abc", "  ")).toBe("abc");
  });
});

describe("hasPhrase", () => {
  it("finds the phrase as words of its own only", () => {
    expect(hasPhrase("Calme, vue mer.", "Vue mer")).toBe(true);
    expect(hasPhrase("Vue merveilleuse", "Vue mer")).toBe(false);
    expect(hasPhrase("", "Vue mer")).toBe(false);
  });
});

describe("removePhrase", () => {
  it("takes the phrase out with its separator, wherever it is", () => {
    expect(removePhrase("Vue mer, Proche des écoles, Avec parking", "Proche des écoles")).toBe("Vue mer, Avec parking");
    expect(removePhrase("Vue mer, Avec parking", "Vue mer")).toBe("Avec parking");
    expect(removePhrase("Vue mer, Avec parking", "Avec parking")).toBe("Vue mer");
    expect(removePhrase("Vue mer", "Vue mer")).toBe("");
    expect(removePhrase("طابق أرضي، فيها باركينغ، مفروشة", "فيها باركينغ")).toBe("طابق أرضي، مفروشة");
  });

  it("keeps sentences apart by a space", () => {
    expect(
      removePhrase("Bonjour. Je suis disponible rapidement. Financement prêt.", "Je suis disponible rapidement."),
    ).toBe("Bonjour. Financement prêt.");
  });

  it("leaves a text without the phrase as it was", () => {
    expect(removePhrase("Vue merveilleuse", "Vue mer")).toBe("Vue merveilleuse");
  });

  it("undoes addPhrase", () => {
    for (const [text, phrase] of [
      ["Vue mer", "Avec parking"],
      ["Bonjour, votre annonce m'intéresse.", "Financement prêt."],
      ["", "Meublé"],
    ]) {
      expect(removePhrase(addPhrase(text, phrase), phrase)).toBe(text);
    }
  });
});

describe("togglePhrase / swapPhrase", () => {
  it("toggles a chip in and out", () => {
    const once = togglePhrase("Vue mer", "Meublé");
    expect(once).toBe("Vue mer, Meublé");
    expect(togglePhrase(once, "Meublé")).toBe("Vue mer");
  });

  it("puts one answer in place of the other", () => {
    expect(swapPhrase("Merci. Rendez-vous à 10 h.", "Rendez-vous à 10 h.", "Rendez-vous à 11 h.")).toBe("Merci. Rendez-vous à 11 h.");
    expect(swapPhrase("Merci.", null, "Rendez-vous à 9 h.")).toBe("Merci. Rendez-vous à 9 h.");
    expect(swapPhrase("Merci. Rendez-vous à 9 h.", "Rendez-vous à 9 h.", null)).toBe("Merci.");
  });

  it("keeps the old answer when the new one does not fit", () => {
    expect(swapPhrase("Merci. À 9 h.", "À 9 h.", "Rendez-vous à 10 h.", 15)).toBe("Merci. À 9 h.");
  });
});
