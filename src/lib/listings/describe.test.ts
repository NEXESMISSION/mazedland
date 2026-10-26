import { describe, it, expect } from "vitest";
import {
  appendDescription,
  describeListing,
  hasLine,
  highlightLine,
  highlightsFor,
  HIGHLIGHTS,
  replaceDescription,
  toggleLine,
  writeDescription,
  type DescribeInput,
} from "./describe";
import { hasContactInText } from "@/lib/moderation/rules";

const flat: DescribeInput = {
  locale: "fr",
  deal: "sale",
  categorySlug: "appartements",
  categoryLabel: "Appartements",
  numbers: { area_sqm: 120, rooms: 3, bathrooms: 2, floor: 2, year_built: 2015 },
  yes: [
    { key: "air_conditioning", label: "Climatisation" },
    { key: "elevator", label: "Ascenseur" },
    { key: "parking", label: "Parking / garage" },
  ],
  governorate: "Ariana",
  delegation: "Ariana Ville",
  quartier: "Ennasr",
  furnished: null,
  availableFrom: null,
  today: "2026-10-26",
};

describe("describeListing — French", () => {
  it("says what, where, how big and what is on site", () => {
    expect(describeListing(flat)).toBe(
      [
        "Appartement à vendre à Ariana Ville (Ariana), quartier Ennasr.",
        "Surface de 120 m², 3 pièces, 2 salles de bain, au 2e étage.",
        "Construit en 2015.",
        "Équipements : climatisation, ascenseur et parking.",
      ].join("\n"),
    );
  });

  it("says a rental's furniture and when it is free", () => {
    const text = describeListing({
      ...flat,
      deal: "rent",
      categorySlug: "villas",
      numbers: { area_sqm: 300, rooms: 5, bathrooms: 1, floor: 0 },
      yes: [{ key: "pool", label: "Piscine" }],
      quartier: null,
      furnished: "furnished",
      availableFrom: "2026-12-01",
    });
    expect(text).toBe(
      [
        "Villa à louer à Ariana Ville (Ariana).",
        "Surface de 300 m², 5 pièces, 1 salle de bain, au rez-de-chaussée.",
        "Équipements : piscine.",
        "Location meublée, libre à partir du 1 décembre 2026.",
      ].join("\n"),
    );
  });

  it("says « libre tout de suite » for today or a day already past", () => {
    const text = describeListing({ ...flat, deal: "rent", furnished: null, availableFrom: "2026-10-20" });
    expect(text.split("\n").at(-1)).toBe("Libre tout de suite.");
  });

  it("agrees with the noun", () => {
    const house = describeListing({ ...flat, categorySlug: "maisons", numbers: { year_built: 1998 } });
    expect(house).toContain("Construite en 1998.");
    const farm = describeListing({
      ...flat,
      categorySlug: "fermes",
      numbers: { area_sqm: 25_000 },
      yes: [{ key: "serviced", label: "Viabilisé" }],
    });
    expect(farm).toContain("Viabilisée.");
  });

  it("says a farm's surface in hectares, and a plot's papers", () => {
    const text = describeListing({
      ...flat,
      categorySlug: "fermes",
      delegation: null,
      quartier: null,
      numbers: { area_sqm: 25_000 },
      yes: [
        { key: "buildable", label: "Constructible" },
        { key: "serviced", label: "Viabilisé" },
        { key: "titled", label: "Titre foncier" },
      ],
    });
    expect(text).toBe(
      ["Ferme à vendre à Ariana.", "Surface de 2,5 ha.", "Constructible et viabilisée, avec titre foncier."].join("\n"),
    );
  });

  it("says the title alone when that is all a plot has", () => {
    const text = describeListing({ ...flat, categorySlug: "terrain", numbers: { area_sqm: 500 }, yes: [{ key: "titled", label: "Titre foncier" }] });
    expect(text.split("\n").at(-1)).toBe("Avec titre foncier.");
  });

  it("calls this year « neuf »", () => {
    expect(describeListing({ ...flat, numbers: { year_built: 2026 } })).toContain("Construction neuve.");
  });

  it("says a question an admin added with its own label", () => {
    const text = describeListing({ ...flat, yes: [{ key: "balcony", label: "Balcon" }] });
    expect(text).toContain("Équipements : balcon.");
  });

  it("leaves out what was not answered", () => {
    const text = describeListing({ ...flat, numbers: {}, yes: [], delegation: null, quartier: null });
    expect(text).toBe("Appartement à vendre à Ariana.");
  });

  it("falls back on the category's label, then on « Bien »", () => {
    expect(describeListing({ ...flat, categorySlug: "chalets", categoryLabel: "Chalets", numbers: {}, yes: [] })).toMatch(/^Chalets à vendre/);
    expect(describeListing({ ...flat, categorySlug: null, categoryLabel: null, numbers: {}, yes: [] })).toMatch(/^Bien à vendre/);
  });

  it("does not say the délégation twice when it is the governorate's name", () => {
    const text = describeListing({ ...flat, governorate: "Tunis", delegation: "Tunis", quartier: null, numbers: {}, yes: [] });
    expect(text).toBe("Appartement à vendre à Tunis.");
  });
});

describe("describeListing — Arabic", () => {
  const ar = { ...flat, locale: "ar" };

  it("writes the same facts in the register of the form", () => {
    expect(describeListing(ar)).toBe(
      [
        "شقة للبيع في أريانة المدينة (أريانة)، حومة Ennasr.",
        "المساحة 120 م²، 3 غرف، زوز حمّامات، في الطابق الثاني.",
        "مبنية سنة 2015.",
        "فيها مكيّف ومصعد ومأوى سيارة.",
      ].join("\n"),
    );
  });

  it("uses the dual and the plural the way they are said", () => {
    const one = describeListing({ ...ar, numbers: { rooms: 1, bathrooms: 1 } });
    expect(one).toContain("غرفة وحدة، حمّام واحد");
    const many = describeListing({ ...ar, numbers: { rooms: 12, bathrooms: 4 } });
    expect(many).toContain("12 غرفة، 4 حمّامات");
  });

  it("agrees with a masculine noun", () => {
    const office = describeListing({ ...ar, categorySlug: "bureaux", numbers: { year_built: 2010 }, yes: [{ key: "elevator", label: "مصعد" }] });
    expect(office).toContain("مكتب للبيع");
    expect(office).toContain("مبني سنة 2010.");
    expect(office).toContain("فيه مصعد.");
  });

  it("says a rental's furniture and when one can move in", () => {
    const text = describeListing({ ...ar, deal: "rent", furnished: "semi", availableFrom: "2026-10-26", numbers: {}, yes: [] });
    expect(text).toBe(["شقة للكراء في أريانة المدينة (أريانة)، حومة Ennasr.", "تتكرى نص مفروشة، تنجم تدخل من توّا."].join("\n"));
  });

  it("says a plot's papers", () => {
    const text = describeListing({
      ...ar,
      categorySlug: "terrain",
      quartier: null,
      numbers: { area_sqm: 500 },
      yes: [
        { key: "buildable", label: "صالحة للبناء" },
        { key: "titled", label: "رسم عقاري" },
      ],
    });
    expect(text.split("\n").slice(1)).toEqual(["المساحة 500 م².", "صالحة للبناء، وعندها رسم عقاري."]);
  });

  it("says the ground floor and hectares", () => {
    expect(describeListing({ ...ar, numbers: { floor: 0 } })).toContain("في الطابق الأرضي");
    expect(describeListing({ ...ar, categorySlug: "fermes", numbers: { area_sqm: 20_000 } })).toContain("المساحة 2 هكتار");
  });
});

describe("describeListing — what moderation reads", () => {
  it("never reads as a phone number, in either language", () => {
    for (const locale of ["fr", "ar"]) {
      const text = describeListing({
        ...flat,
        locale,
        deal: "rent",
        categorySlug: "terrain",
        numbers: { area_sqm: 98_765_432, rooms: 25, bathrooms: 12, floor: 23, year_built: 2024 },
        furnished: "unfurnished",
        availableFrom: "2027-12-31",
      });
      expect(hasContactInText(text), text).toBe(false);
    }
  });
});

describe("highlightsFor", () => {
  it("offers all of them for a home on sale", () => {
    expect(highlightsFor("appartements", "residential", "sale")).toEqual([...HIGHLIGHTS]);
  });

  it("keeps « Titre bleu » for a sale", () => {
    expect(highlightsFor("appartements", "residential", "rent")).not.toContain("blueTitle");
  });

  it("drops the apartment ones for land and farms", () => {
    for (const slug of ["terrain", "fermes"]) {
      const offered = highlightsFor(slug, "land", "sale");
      expect(offered).not.toContain("equippedKitchen");
      expect(offered).not.toContain("terrace");
      expect(offered).not.toContain("secureResidence");
      expect(offered).not.toContain("renovated");
      expect(offered).not.toContain("highStandard");
      expect(offered).toContain("seaView");
      expect(offered).toContain("blueTitle");
    }
  });

  it("drops a family's ones for a shop, an office or a dépôt", () => {
    const offered = highlightsFor("bureaux", "commercial", "rent");
    expect(offered).not.toContain("nearSchools");
    expect(offered).not.toContain("equippedKitchen");
    expect(offered).toContain("nearShops");
    expect(offered).toContain("easyAccess");
  });

  it("goes by the kind for a category added later", () => {
    expect(highlightsFor("hangars", "land", "sale")).not.toContain("terrace");
  });
});

describe("highlight lines", () => {
  const sea = highlightLine("seaView", "fr");

  it("is one bullet line, in the page's language", () => {
    expect(sea).toBe("• Vue sur la mer");
    expect(highlightLine("quietArea", "ar")).toBe("• حومة هادية");
  });

  it("adds a line once, at the end", () => {
    const once = toggleLine("Bel appartement.", sea);
    expect(once).toBe("Bel appartement.\n• Vue sur la mer");
    expect(hasLine(once, sea)).toBe(true);
    expect(toggleLine("", sea)).toBe(sea);
  });

  it("takes out only the line it added", () => {
    const text = "Bel appartement.\n• Vue sur la mer\nVue sur la mer depuis le salon.";
    expect(toggleLine(text, sea)).toBe("Bel appartement.\nVue sur la mer depuis le salon.");
  });

  it("does not mistake a sentence that mentions the sea for the line", () => {
    expect(hasLine("Vue sur la mer depuis le salon.", sea)).toBe(false);
  });
});

describe("writing the description into the box", () => {
  const generated = "Appartement à vendre à Ariana.";
  const lines = [highlightLine("seaView", "fr"), highlightLine("terrace", "fr")];

  it("fills an empty box", () => {
    expect(writeDescription("  ", generated, { lastGenerated: null, highlightLines: lines })).toEqual({ text: generated });
  });

  it("goes above highlights already tapped", () => {
    const current = `${lines[0]}\n${lines[1]}`;
    expect(writeDescription(current, generated, { lastGenerated: null, highlightLines: lines })).toEqual({
      text: `${generated}\n${lines[0]}\n${lines[1]}`,
    });
  });

  it("rewrites its own text and keeps what follows", () => {
    const before = "Appartement à vendre à Tunis.";
    const current = `${before}\n${lines[0]}\nAu calme.`;
    expect(writeDescription(current, generated, { lastGenerated: before, highlightLines: lines })).toEqual({
      text: `${generated}\n${lines[0]}\nAu calme.`,
    });
  });

  it("asks before touching words the seller typed", () => {
    expect(writeDescription("Très lumineux.", generated, { lastGenerated: null, highlightLines: lines })).toEqual({ ask: true });
    // Typed over the text written last time: theirs now.
    expect(writeDescription("Appartement lumineux.", generated, { lastGenerated: "Appartement à vendre à Tunis.", highlightLines: lines })).toEqual({ ask: true });
  });

  it("« Remplacer » keeps the highlights, « Ajouter » keeps everything", () => {
    const current = `Très lumineux.\n${lines[1]}`;
    expect(replaceDescription(current, generated, lines)).toBe(`${generated}\n${lines[1]}`);
    expect(replaceDescription("Très lumineux.", generated, lines)).toBe(generated);
    expect(appendDescription("Très lumineux.\n", generated)).toBe(`Très lumineux.\n\n${generated}`);
  });
});
