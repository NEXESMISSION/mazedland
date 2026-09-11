import { describe, it, expect } from "vitest";
import { usablePayeeMethods } from "./index";

const real = {
  name: "Mazed Immo SARL",
  bank: "Banque Internationale Arabe de Tunisie",
  rib: "08 006 0123456789012 34",
  iban: "TN59 0800 6012 3456 7890 1234",
  d17: "22 333 444",
};

describe("usablePayeeMethods", () => {
  it("offers both methods when every detail is real", () => {
    expect(usablePayeeMethods(real)).toEqual({ bank_transfer: true, d17: true });
  });

  it("refuses the built-in example account, whitespace or not", () => {
    expect(usablePayeeMethods({ ...real, rib: "07003 0001234567890 78" }).bank_transfer).toBe(false);
    expect(usablePayeeMethods({ ...real, iban: "TN5907003000012345678907 8" }).bank_transfer).toBe(false);
    expect(usablePayeeMethods({ ...real, d17: "55123456" }).d17).toBe(false);
  });

  it("offers only the method that is filled in", () => {
    expect(usablePayeeMethods({ ...real, d17: "" })).toEqual({ bank_transfer: true, d17: false });
    expect(usablePayeeMethods({ ...real, rib: "", iban: "" })).toEqual({ bank_transfer: false, d17: true });
  });

  it("refuses everything without a payee name, or under the old brand", () => {
    expect(usablePayeeMethods({ ...real, name: " " })).toEqual({ bank_transfer: false, d17: false });
    expect(usablePayeeMethods({ ...real, name: "Batta Tunisia SARL" })).toEqual({ bank_transfer: false, d17: false });
  });
});
