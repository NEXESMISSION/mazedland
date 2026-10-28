import { describe, expect, it } from "vitest";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import { CREDIT_NOTE_REASONS, CREDIT_NOTE_REASON_KEYS, creditNoteReason } from "./creditNote";

describe("credit note reasons", () => {
  it("only the console's choices pass", () => {
    expect(creditNoteReason("test")).toBe("test");
    expect(creditNoteReason("refunded")).toBe("refunded");
    expect(creditNoteReason("Paiement de test")).toBeNull();
    expect(creditNoteReason("toString")).toBeNull();
    expect(creditNoteReason("")).toBeNull();
    expect(creditNoteReason(undefined)).toBeNull();
  });

  it("every reason has a printed text and a label in both languages", () => {
    const frReasons = fr.adminPayments.detail.creditReasons as Record<string, string>;
    const arReasons = ar.adminPayments.detail.creditReasons as Record<string, string>;
    for (const key of CREDIT_NOTE_REASON_KEYS) {
      expect(CREDIT_NOTE_REASONS[key].length).toBeGreaterThan(5);
      expect(frReasons[key], `fr ${key}`).toBeTruthy();
      expect(arReasons[key], `ar ${key}`).toBeTruthy();
    }
  });
});
