import { getTranslations } from "next-intl/server";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { productName } from "@/lib/products";
import { creditedPeriodIds, invoiceLines, type InvoiceLine, type InvoiceLineWords } from "./invoiceLines";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export type InvoiceLinePayment = {
  id: string;
  kind: string | null;
  amount: number | string;
  metadata: Record<string, unknown> | null;
};

/**
 * The lines of a payment's invoice (invoiceLines.ts), with what only the
 * database knows: the period the payment bought, and the plans of the
 * periods an upgrade took off the price. Read with the service client — the
 * invoice page and the console's payment pane both call it.
 */
export async function loadInvoiceLines(
  admin: Admin,
  pay: InvoiceLinePayment,
  label: string,
  locale: string,
): Promise<InvoiceLine[]> {
  const creditedIds = creditedPeriodIds(pay.metadata);
  const [tr, { data: periodRows }, { data: creditedRows }] = await Promise.all([
    getTranslations({ locale, namespace: "invoice.lines" }),
    admin.from("shop_subscriptions").select("starts_at, ends_at").eq("payment_id", pay.id).limit(1),
    creditedIds.length
      ? admin.from("shop_subscriptions").select("id, product:products (name_fr, name_ar)").in("id", creditedIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const period = ((periodRows ?? []) as { starts_at: string; ends_at: string }[])[0] ?? null;
  const planNames: Record<string, string> = {};
  for (const row of (creditedRows ?? []) as { id: string; product: unknown }[]) {
    const p = (Array.isArray(row.product) ? row.product[0] : row.product) as { name_fr: string; name_ar: string | null } | null;
    if (p?.name_fr) planNames[row.id] = productName({ nameFr: p.name_fr, nameAr: p.name_ar }, locale);
  }
  // The typed translator narrows its keys to the messages' literals; the words
  // are the six the lines ask for.
  const t: InvoiceLineWords = (key, values) =>
    (tr as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
  return invoiceLines(
    { kind: pay.kind, amount: Number(pay.amount) || 0, label, metadata: pay.metadata },
    { locale, t, period, planNames },
  );
}
