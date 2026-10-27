import { describe, it, expect } from "vitest";
import { paymentsOpen, usablePayeeMethods } from "./index";
import { settingsFromRows } from "@/lib/settings/server";

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

  it("refuses everything without a payee name", () => {
    expect(usablePayeeMethods({ ...real, name: "" })).toEqual({ bank_transfer: false, d17: false });
    expect(usablePayeeMethods({ ...real, name: " " })).toEqual({ bank_transfer: false, d17: false });
  });
});

describe("paymentsOpen", () => {
  const settings = {
    payee_name: real.name,
    payee_bank: real.bank,
    payee_rib: real.rib,
    payee_iban: real.iban,
    payee_d17: real.d17,
  };

  it("is closed on a site where nobody entered the payee yet", () => {
    // What the registry reads when app_settings holds no payee row.
    expect(paymentsOpen(settingsFromRows([]))).toBe(false);
  });

  it("is closed while the seed's example account is still there", () => {
    expect(
      paymentsOpen({
        payee_name: "Mazed Immo Tunisia SARL",
        payee_bank: "Société Tunisienne de Banque (STB)",
        payee_rib: "07 003 0001234567890 78",
        payee_iban: "TN59 0700 3000 0123 4567 8907 8",
        payee_d17: "55 123 456",
      }),
    ).toBe(false);
  });

  it("opens as soon as one method is real", () => {
    expect(paymentsOpen(settings)).toBe(true);
    expect(paymentsOpen({ ...settings, payee_rib: "", payee_iban: "" })).toBe(true);
    expect(paymentsOpen({ ...settings, payee_d17: "" })).toBe(true);
  });

  it("stays closed with a number but no name to pay", () => {
    expect(paymentsOpen({ ...settings, payee_name: "" })).toBe(false);
  });

  it("reads the stored rows the way the site does", () => {
    const rows = Object.entries({ ...settings, payee_rib: "", payee_iban: "" }).map(([key, value]) => ({ key, value }));
    expect(paymentsOpen(settingsFromRows(rows))).toBe(true);
  });
});
