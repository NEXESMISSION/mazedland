import { describe, it, expect } from "vitest";
import { draftNeedsChoice } from "./wizard";

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
