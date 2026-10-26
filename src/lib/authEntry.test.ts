import { describe, it, expect } from "vitest";
import { otpEntry, phoneEntry } from "./authEntry";

describe("phoneEntry", () => {
  it("moves the code of a number autofilled or pasted whole to the chip", () => {
    expect(phoneEntry("+216 22 123 456", "+216", true)).toEqual({ dialCode: "+216", number: "22123456" });
    expect(phoneEntry("0021622123456", "+216", true)).toEqual({ dialCode: "+216", number: "22123456" });
    expect(phoneEntry("+33 6 12 34 56 78", "+216", true)).toEqual({ dialCode: "+33", number: "612345678" });
    expect(phoneEntry("+971 50 123 4567", "+216", true)).toEqual({ dialCode: "+971", number: "501234567" });
  });
  it("keeps the chip for a number without a code", () => {
    expect(phoneEntry("22 123 456", "+216", true)).toEqual({ dialCode: "+216", number: "22123456" });
    expect(phoneEntry("06 12 34 56 78", "+33", true)).toEqual({ dialCode: "+33", number: "0612345678" });
  });
  it("keeps the chip for a code it does not offer", () => {
    expect(phoneEntry("+999 123 456", "+216", true)).toEqual({ dialCode: "+216", number: "999123456" });
  });
  it("never re-reads a code typed key by key", () => {
    expect(phoneEntry("0020", "+216", false)).toEqual({ dialCode: "+216", number: "0020" });
    expect(phoneEntry("+33", "+216", false)).toEqual({ dialCode: "+216", number: "33" });
  });
  it("moves a code only with a number behind it", () => {
    expect(phoneEntry("0020", "+216", true)).toEqual({ dialCode: "+216", number: "0020" });
    expect(phoneEntry("+33 6", "+216", true)).toEqual({ dialCode: "+216", number: "336" });
  });
  it("drops 216 typed in front of a Tunisian number", () => {
    expect(phoneEntry("21622123456", "+216", false)).toEqual({ dialCode: "+216", number: "22123456" });
    expect(phoneEntry("21622123456", "+33", false)).toEqual({ dialCode: "+33", number: "21622123456" });
  });
});

describe("otpEntry", () => {
  it("takes the code out of a pasted SMS", () => {
    expect(otpEntry("Votre code Mazed Immo : 482913. Il expire dans 10 min.")).toBe("482913");
    expect(otpEntry("رمز التحقق متاعك 482913")).toBe("482913");
  });
  it("joins a code pasted with a space", () => {
    expect(otpEntry("482 913")).toBe("482913");
  });
  it("keeps typed digits, up to six", () => {
    expect(otpEntry("48")).toBe("48");
    expect(otpEntry("4829135")).toBe("482913");
    expect(otpEntry("")).toBe("");
  });
});
