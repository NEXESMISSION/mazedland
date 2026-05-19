/**
 * Batta.tn — manual payment instructions.
 *
 * The app is intentionally gateway-free. Every payment runs through
 * the same offline flow:
 *
 *   1. Buyer picks bank transfer or D17 at checkout.
 *   2. Shown the payee details + a unique reference.
 *   3. Pays externally (wire transfer or D17 push).
 *   4. Uploads a screenshot / photo of the receipt.
 *   5. Admin reviews on /admin/payments; accept → status='captured'
 *      (downstream triggers fire), reject → status='failed' with a
 *      reason the buyer sees in their notifications.
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

/** Payee details — pulled from app_settings server-side. */
export type PayeeDetails = {
  name: string;
  bank: string;
  rib: string;
  iban: string;
  d17: string;
};

const DEFAULT_PAYEE: PayeeDetails = {
  name: "Batta Tunisia SARL",
  bank: "Société Tunisienne de Banque (STB)",
  rib: "07 003 0001234567890 78",
  iban: "TN59 0700 3000 0123 4567 8907 8",
  d17: "55 123 456",
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
 * UI needs to render them. If `payee` is omitted, falls back to the
 * defaults (test data); production callers should always pass the
 * admin-controlled values fetched from `app_settings`.
 */
export function paymentInstructions(opts: {
  paymentId: string;
  amountTND: number;
  payee?: PayeeDetails;
}): ProviderInstructions[] {
  const ref = paymentReference(opts.paymentId);
  const amt = fmt(opts.amountTND);
  const p = opts.payee ?? DEFAULT_PAYEE;

  return [
    {
      value: "bank_transfer",
      label: "Virement bancaire (RIB)",
      shortLabel: "Virement",
      description:
        "Effectuez un virement depuis votre application bancaire ou en agence vers le compte ci-dessous, puis revenez ici pour téléverser le reçu.",
      fields: [
        { label: "Bénéficiaire", value: p.name },
        { label: "Banque", value: p.bank },
        { label: "RIB", value: p.rib, copyable: true, mono: true },
        { label: "IBAN", value: p.iban, copyable: true, mono: true },
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
        { label: "Numéro D17 Batta", value: p.d17, copyable: true, mono: true },
        { label: "Bénéficiaire", value: p.name },
        { label: "Montant", value: `${amt} TND`, copyable: true, mono: true },
        { label: "Référence (libellé du transfert)", value: ref, copyable: true, mono: true },
      ],
      nextStep:
        "Téléversez la capture d'écran de la confirmation D17 (référence + montant lisibles).",
    },
  ];
}

/**
 * Server-only helper — fetches the admin-tunable payee details from
 * `app_settings`. Falls back to defaults if a key is missing so the
 * checkout never breaks on a fresh DB.
 *
 * Typed as `any` for the client param: we'd otherwise have to import
 * the heavy generated Supabase type just to satisfy the structural
 * shape, and that pulled the TS resolver into "excessively deep"
 * territory on this builder chain. The runtime shape is well-known
 * (PostgREST `app_settings` returns `{ key, value }[]`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchPayeeDetails(supabase: any): Promise<PayeeDetails> {
  const { data } = (await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "payee_name",
      "payee_bank",
      "payee_rib",
      "payee_iban",
      "payee_d17",
    ])) as { data: { key: string; value: unknown }[] | null };

  const m = new Map<string, string>();
  for (const row of data ?? []) {
    const v = row.value;
    m.set(row.key, typeof v === "string" ? v : v == null ? "" : String(v));
  }
  return {
    name: m.get("payee_name") || DEFAULT_PAYEE.name,
    bank: m.get("payee_bank") || DEFAULT_PAYEE.bank,
    rib: m.get("payee_rib") || DEFAULT_PAYEE.rib,
    iban: m.get("payee_iban") || DEFAULT_PAYEE.iban,
    d17: m.get("payee_d17") || DEFAULT_PAYEE.d17,
  };
}
