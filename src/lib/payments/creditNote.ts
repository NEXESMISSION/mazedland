/**
 * Why a credit note cancels an invoice (0187). The console offers these —
 * nothing is typed — and the text is printed on the credit note itself, so it
 * is French, like the invoice it cancels, and reads the same every time.
 */
export const CREDIT_NOTE_REASONS = {
  test: "Paiement de test",
  refunded: "Remboursé au client",
  mistake: "Paiement accepté par erreur",
} as const;

export type CreditNoteReason = keyof typeof CREDIT_NOTE_REASONS;

export const CREDIT_NOTE_REASON_KEYS = Object.keys(CREDIT_NOTE_REASONS) as CreditNoteReason[];

/** The reason the console sent, or null when it is not one of the choices. */
export function creditNoteReason(value: unknown): CreditNoteReason | null {
  return typeof value === "string" && Object.hasOwn(CREDIT_NOTE_REASONS, value)
    ? (value as CreditNoteReason)
    : null;
}
