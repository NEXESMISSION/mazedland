import { describe, it, expect } from "vitest";
import { buildSystemPrompt, normalizeListingDraft, type DraftCategory } from "./listing";
import { redactContacts } from "@/lib/moderation/rules";

const CATS: DraftCategory[] = [
  { slug: "maisons", label: "Maisons", kind: "residential" },
  { slug: "appartements", label: "Appartements", kind: "residential" },
  { slug: "terrain", label: "Terrain", kind: "land" },
];

const answer = (over: Record<string, unknown> = {}) => ({
  language: "ar",
  deal_type: "sale",
  category_slug: "maisons",
  governorate: "Sfax",
  delegation: "طريق قرمدة",
  price_tnd: 350_000,
  price_unclear: false,
  area_sqm: 180,
  rooms: null,
  bathrooms: null,
  floor: null,
  furnished: null,
  deposit_tnd: null,
  charges_tnd: null,
  available_from: null,
  min_lease_months: null,
  legal_claims: [],
  title: "دار 180 م² · طريق قرمدة، صفاقس",
  description: "دار في طريق قرمدة بصفاقس، مساحتها 180 م².",
  questions: ["قدّاش من بيت فيها؟"],
  ...over,
});

const SOURCE = "عندي دار في صفاقس، طريق قرمدة، 180 متر، نحب نبيعها بـ350 مليون، عندها رسم عقاري";

describe("normalizeListingDraft", () => {
  it("keeps what the seller said and what the site accepts", () => {
    const d = normalizeListingDraft(answer(), { categories: CATS, sourceText: SOURCE });
    expect(d).toMatchObject({
      deal: "sale",
      categorySlug: "maisons",
      governorate: "Sfax",
      delegation: "طريق قرمدة",
      price: 350_000,
      areaSqm: 180,
      questions: ["قدّاش من بيت فيها؟"],
    });
  });

  it("drops a category or a governorate the site does not have", () => {
    const d = normalizeListingDraft(answer({ category_slug: "chateaux", governorate: "Atlantis" }), {
      categories: CATS,
      sourceText: SOURCE,
    });
    expect(d.categorySlug).toBeNull();
    expect(d.governorate).toBeNull();
  });

  it("does not fill the price box with a misread amount", () => {
    // « 350 » read as 350 TND for a house, or a flagged ambiguity.
    expect(normalizeListingDraft(answer({ price_tnd: 350 }), { categories: CATS, sourceText: SOURCE }).price).toBeNull();
    expect(
      normalizeListingDraft(answer({ price_unclear: true }), { categories: CATS, sourceText: SOURCE }).price,
    ).toBeNull();
    // A rent is monthly: 1 200 is a rent, not a misreading.
    expect(
      normalizeListingDraft(answer({ deal_type: "rent", price_tnd: 1200 }), { categories: CATS, sourceText: SOURCE }).price,
    ).toBe(1200);
  });

  it("keeps a legal fact only when the seller's words are quoted", () => {
    const said = normalizeListingDraft(
      answer({ legal_claims: [{ field: "titled", value: true, quote: "عندها رسم عقاري" }] }),
      { categories: CATS, sourceText: SOURCE },
    );
    expect(said.legal).toEqual({ titled: true });
    const invented = normalizeListingDraft(
      answer({ legal_claims: [{ field: "buildable", value: true, quote: "صالحة للبناء" }] }),
      { categories: CATS, sourceText: SOURCE },
    );
    expect(invented.legal).toEqual({});
  });

  it("asks rent questions only of a rental and keeps at most three questions", () => {
    const sale = normalizeListingDraft(answer({ furnished: "furnished", deposit_tnd: 2400 }), {
      categories: CATS,
      sourceText: SOURCE,
    });
    expect(sale.furnished).toBeNull();
    expect(sale.deposit).toBeNull();
    const many = normalizeListingDraft(answer({ questions: ["a?", "b?", "c?", "d?"] }), {
      categories: CATS,
      sourceText: SOURCE,
    });
    expect(many.questions).toHaveLength(3);
  });

  it("removes a contact detail from the generated text", () => {
    const d = normalizeListingDraft(
      answer({ description: "دار مزيانة في صفاقس. اتصل بي على 98 123 456." }),
      { categories: CATS, sourceText: SOURCE },
    );
    expect(d.description).toBe("دار مزيانة في صفاقس.");
  });

  it("survives an answer that is not an object at all", () => {
    const d = normalizeListingDraft(null, { categories: CATS, sourceText: SOURCE });
    expect(d.deal).toBe("sale");
    expect(d.price).toBeNull();
    expect(d.questions).toEqual([]);
  });
});

describe("redactContacts", () => {
  it("takes numbers, e-mails and links out of what is sent to the model", () => {
    expect(redactContacts("دار في صفاقس، كلمني 98 124 111 ولا ahmed@gmail.com")).toBe("دار في صفاقس، كلمني […] ولا […]");
    expect(redactContacts("Villa 300 m² à 450 000 TND")).toBe("Villa 300 m² à 450 000 TND");
  });
});

describe("buildSystemPrompt", () => {
  it("names every category and the Tunisian « million »", () => {
    const p = buildSystemPrompt(CATS);
    for (const c of CATS) expect(p).toContain(c.slug);
    expect(p).toContain("350 مليون");
  });
});
