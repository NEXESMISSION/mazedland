import { describe, it, expect } from "vitest";
import { asPendingEdit, changedKeys, newFlags } from "./edit";
import { listingFields, listingPhotos } from "./input";

describe("newFlags", () => {
  it("holds back only what the edit itself trips", () => {
    // The live version already had too few photos and an untrusted seller;
    // the edit adds a phone number in the text.
    expect(newFlags(["first_listing", "too_few_photos"], ["first_listing", "too_few_photos", "contact_in_text"])).toEqual([
      "contact_in_text",
    ]);
  });
  it("lets a clean edit through", () => {
    expect(newFlags(["too_few_photos"], ["too_few_photos"])).toEqual([]);
    expect(newFlags(["too_few_photos"], [])).toEqual([]);
  });
});

describe("changedKeys", () => {
  const current = { title: "Villa S+4", price: 850000, price_on_request: false, attributes: { area_sqm: 300 } };
  it("lists the fields whose value changes, photos included", () => {
    const keys = changedKeys(
      current,
      {
        fields: { title: "Villa S+4", price: 800000, price_on_request: false, attributes: { area_sqm: 320 } },
        photos: [{ storage_path: "b.webp", sort_order: 0 }, { storage_path: "a.webp", sort_order: 1 }],
      },
      ["a.webp", "b.webp"],
    );
    expect(keys).toEqual(["price", "attributes", "photos"]);
  });
  it("sees nothing when the edit repeats what is online", () => {
    expect(changedKeys(current, { fields: { ...current }, photos: [{ storage_path: "a.webp", sort_order: 0 }] }, ["a.webp"])).toEqual([]);
  });
});

describe("asPendingEdit", () => {
  it("reads back what proposeEdit stored, and refuses anything else", () => {
    expect(asPendingEdit({ fields: { price: 1 }, photos: null, flags: ["contact_in_text"], submittedAt: "2026-10-24T10:00:00Z" })).toEqual({
      fields: { price: 1 },
      photos: null,
      flags: ["contact_in_text"],
      submittedAt: "2026-10-24T10:00:00Z",
    });
    expect(asPendingEdit(null)).toBeNull();
    expect(asPendingEdit({ flags: [] })).toBeNull();
  });
});

describe("the form, as the server reads it", () => {
  it("sets only what was sent, typed and bounded", () => {
    const f = listingFields({ title: "  Appartement S+2  ", price: "1200", price_on_request: false, deal_type: "rent", furnished: "furnished" });
    expect(f.title).toBe("Appartement S+2");
    expect(f.price).toBe(1200);
    expect(f.deal_type).toBe("rent");
    expect(f.furnished).toBe("furnished");
    expect("description" in f).toBe(false);
    expect("governorate" in f).toBe(false);
  });
  it("clears the rent facts when an annonce becomes a sale", () => {
    const f = listingFields({ deal_type: "sale", deposit_amount: 2400 });
    expect(f.deposit_amount).toBeNull();
    expect(f.furnished).toBeNull();
  });
  it("drops a phone number that is not one, and a price on request has no price", () => {
    expect(listingFields({ contact_phone: "abc" }).contact_phone).toBeNull();
    expect(listingFields({ price: 5000, price_on_request: true }).price).toBeNull();
  });
  it("keeps the gallery in the order sent, without empty paths", () => {
    expect(listingPhotos({ photos: [{ storage_path: "a" }, { storage_path: "" }, { storage_path: "b" }] })).toEqual([
      { storage_path: "a", sort_order: 0 },
      { storage_path: "b", sort_order: 1 },
    ]);
    expect(listingPhotos({})).toBeNull();
  });
});
