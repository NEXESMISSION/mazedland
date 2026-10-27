import { describe, it, expect } from "vitest";
import {
  attributeFieldId,
  draftNeedsChoice,
  listOfFields,
  missingOnStep,
  stepOfField,
} from "./wizard";

describe("draftNeedsChoice", () => {
  const sale = { deal_type: "sale" };
  const rent = { deal_type: "rent" };

  it("asks when the deal in the URL is not the newest draft's", () => {
    // « J'ai un bien à louer » with a sale draft waiting: report #09.
    expect(draftNeedsChoice({ opened: false, askedDeal: "rent", draft: sale })).toBe(true);
    expect(draftNeedsChoice({ opened: false, askedDeal: "sale", draft: rent })).toBe(true);
  });

  it("reads a draft saved before 0166, with no deal, as a sale", () => {
    expect(draftNeedsChoice({ opened: false, askedDeal: "rent", draft: { deal_type: null } })).toBe(true);
    expect(draftNeedsChoice({ opened: false, askedDeal: "sale", draft: {} })).toBe(false);
  });

  it("resumes as before when the deals agree", () => {
    expect(draftNeedsChoice({ opened: false, askedDeal: "rent", draft: rent })).toBe(false);
    expect(draftNeedsChoice({ opened: false, askedDeal: "sale", draft: sale })).toBe(false);
  });

  it("does not ask without a deal in the URL, or with one that is not a deal", () => {
    expect(draftNeedsChoice({ opened: false, askedDeal: undefined, draft: sale })).toBe(false);
    expect(draftNeedsChoice({ opened: false, askedDeal: "RENT", draft: sale })).toBe(false);
    expect(draftNeedsChoice({ opened: false, askedDeal: "", draft: rent })).toBe(false);
  });

  it("does not ask when there is no draft to resume", () => {
    expect(draftNeedsChoice({ opened: false, askedDeal: "rent", draft: null })).toBe(false);
  });

  it("never second-guesses ?draft= or ?edit=", () => {
    expect(draftNeedsChoice({ opened: true, askedDeal: "rent", draft: sale })).toBe(false);
  });
});

describe("stepOfField", () => {
  it("puts each field on its step", () => {
    expect(stepOfField("f-category")).toBe(0);
    expect(stepOfField("f-photos")).toBe(1);
    expect(stepOfField("f-price")).toBe(2);
    expect(stepOfField("f-title")).toBe(2);
    expect(stepOfField("f-phone")).toBe(3);
    expect(stepOfField("f-attestation")).toBe(3);
  });

  it("puts every catalogue question with the price and details", () => {
    expect(stepOfField(attributeFieldId("area_sqm"))).toBe(2);
    expect(stepOfField(attributeFieldId("titre_foncier"))).toBe(2);
  });

  it("knows nothing of a field it was not told about", () => {
    expect(stepOfField("f-nope")).toBeUndefined();
  });
});

describe("missingOnStep", () => {
  const missing = [
    { fieldId: "f-category", name: "le type de bien" },
    { fieldId: "f-photos", name: "les photos" },
    { fieldId: "f-price", name: "le prix" },
    { fieldId: attributeFieldId("area_sqm"), name: "surface" },
    { fieldId: "f-phone", name: "le téléphone" },
  ];

  it("keeps only what the step on screen lacks", () => {
    expect(missingOnStep(missing, 2, { photosUploading: false }).map((m) => m.name)).toEqual([
      "le prix",
      "surface",
    ]);
    expect(missingOnStep(missing, 3, { photosUploading: false }).map((m) => m.name)).toEqual(["le téléphone"]);
  });

  it("does not hold the seller on the photos step while photos are still uploading", () => {
    expect(missingOnStep(missing, 1, { photosUploading: true })).toEqual([]);
    expect(missingOnStep(missing, 1, { photosUploading: false })).toHaveLength(1);
  });
});

describe("listOfFields", () => {
  it("names the missing fields as one phrase, in the page's language", () => {
    expect(listOfFields(["le prix", "le titre"], "fr")).toBe("le prix et le titre");
    expect(listOfFields(["le prix", "le titre", "surface"], "fr")).toBe("le prix, le titre et surface");
    expect(listOfFields(["السعر", "العنوان"], "ar")).toBe("السعر والعنوان");
  });

  it("names each field once, and skips an empty name", () => {
    expect(listOfFields(["le prix", "le prix", " "], "fr")).toBe("le prix");
    expect(listOfFields([], "fr")).toBe("");
  });
});
