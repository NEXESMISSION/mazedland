import { describe, it, expect } from "vitest";
import { clipboardText } from "./clipboard";

describe("clipboardText", () => {
  it("copies an amount as a number, in either language", () => {
    expect(clipboardText("15.00 TND")).toBe("15.00");
    expect(clipboardText("15.00 د.ت")).toBe("15.00");
    expect(clipboardText("120,500 DT")).toBe("120,500");
  });
  it("copies a RIB, a D17 number and an IBAN without their spaces", () => {
    expect(clipboardText("07 003 0001234567890 78")).toBe("07003000123456789078");
    expect(clipboardText("55 123 456")).toBe("55123456");
    expect(clipboardText("TN59 0700 3000 0123 4567 8907 8")).toBe("TN59070030000123456789078");
  });
  it("copies the reference and the names as shown", () => {
    expect(clipboardText("MAZED IMMO-1A2B3C4D")).toBe("MAZED IMMO-1A2B3C4D");
    expect(clipboardText("Mazed Immo Tunisia SARL")).toBe("Mazed Immo Tunisia SARL");
  });
});
