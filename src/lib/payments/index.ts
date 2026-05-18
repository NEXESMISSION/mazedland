/**
 * Batta.tn — manual payment instructions.
 *
 * Tunisian banking realities: API integrations with Konnect / Paymee /
 * Flouci require commercial agreements that we don't yet have, and D17
 * has no public API at all. So instead of trying to drive a gateway,
 * we run an offline flow:
 *
 *   1. Buyer picks bank transfer or D17 at checkout.
 *   2. Shown the payee details + a unique reference.
 *   3. Pays externally (wire transfer or D17 push).
 *   4. Uploads a screenshot / photo of the receipt.
 *   5. Admin reviews on /admin/payments; accept → status='captured'
 *      (downstream triggers fire), reject → status='failed' with a
 *      reason the buyer sees in their notifications.
 *
 * Replace this module with a real gateway abstraction once API access
 * is in place.
 */

import type { PaymentProvider } from "./types";

export type InstructionField = {
  label: string;
  value: string;
  /** Render a copy-to-clipboard button. */
  copyable?: boolean;
  /** Render in monospaced tabular type — IBANs, references, amounts. */
  mono?: boolean;
};

export type ProviderInstructions = {
  value: PaymentProvider;
  label: string;
  shortLabel: string;
  description: string;
  fields: InstructionField[];
  /** What the buyer must do after paying. */
  nextStep: string;
};

/**
 * Build a short, human-readable reference the buyer types in the
 * "communication" / "motif" field of their transfer. We use the first
 * 8 chars of the payment UUID, uppercased, prefixed with BATTA. That
 * gives admin a one-line search key to match a bank statement against a
 * payments row.
 */
export function paymentReference(paymentId: string): string {
  return `BATTA-${paymentId.slice(0, 8).toUpperCase()}`;
}

/**
 * Format a TND amount the same way it appears on bank statements —
 * 2 decimals, dot separator, no currency suffix (added by the UI).
 */
function fmt(amountTND: number): string {
  return amountTND.toFixed(2);
}

/**
 * Returns both payment options (bank transfer + D17) with the data the
 * UI needs to render them. The bank details are placeholders — swap
 * with the real Batta.tn account once it's open.
 */
export function paymentInstructions(opts: {
  paymentId: string;
  amountTND: number;
}): ProviderInstructions[] {
  const ref = paymentReference(opts.paymentId);
  const amt = fmt(opts.amountTND);

  return [
    {
      value: "bank_transfer",
      label: "Virement bancaire (RIB)",
      shortLabel: "Virement",
      description:
        "Effectuez un virement depuis votre application bancaire ou en agence vers le compte ci-dessous, puis revenez ici pour téléverser le reçu.",
      fields: [
        { label: "Bénéficiaire", value: "Batta Tunisia SARL" },
        { label: "Banque", value: "Société Tunisienne de Banque (STB)" },
        { label: "RIB", value: "07 003 0001234567890 78", copyable: true, mono: true },
        { label: "IBAN", value: "TN59 0700 3000 0123 4567 8907 8", copyable: true, mono: true },
        { label: "Montant", value: `${amt} TND`, copyable: true, mono: true },
        { label: "Référence (à indiquer dans le motif)", value: ref, copyable: true, mono: true },
      ],
      nextStep:
        "Téléversez une photo lisible de votre ordre de virement (reçu, capture e-banking, ou avis d'agence).",
    },
    {
      value: "d17",
      label: "D17 · La Poste Tunisienne",
      shortLabel: "D17",
      description:
        "Envoyez le montant depuis votre application D17 vers le numéro Batta, puis téléversez la confirmation reçue par SMS ou dans l'app.",
      fields: [
        { label: "Numéro D17 Batta", value: "55 123 456", copyable: true, mono: true },
        { label: "Bénéficiaire", value: "Batta Tunisia" },
        { label: "Montant", value: `${amt} TND`, copyable: true, mono: true },
        { label: "Référence (libellé du transfert)", value: ref, copyable: true, mono: true },
      ],
      nextStep:
        "Téléversez la capture d'écran de la confirmation D17 (référence + montant lisibles).",
    },
  ];
}
