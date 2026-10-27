import { describe, it, expect } from "vitest";
import {
  attributeFieldId,
  listOfFields,
  missingOnStep,
  stepOfField,
} from "./wizard";

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
