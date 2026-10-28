import { formatDate } from "@/lib/utils";

/**
 * What an invoice is for, line by line (the owner, 2026-10-28: « the invoice
 * says what he bought and what we took off, not one figure »).
 *
 * An invoice stores one label and its totals (0175). The payment it was
 * issued for still carries what the checkout quoted (planChange.ts): the
 * plan's list price, the period, and for an upgrade the time left on the
 * smaller plan that was taken off the price. These lines are read from that,
 * so the invoice page and the console's payment pane say the same thing:
 *
 *   Abonnement Pro · du 28 oct. 2026 au 28 nov. 2026 · 40 annonces   59,000
 *   Remise — temps restant de l'abonnement Starter · 31 jours        −28,000
 *   Total                                                             31,000
 *
 * A payment quoted before 2026-10-28 has no list price: one line, at what was
 * paid, with the period its subscription row gives.
 */
export type InvoiceLine = {
  /** The plan or the service. */
  label: string;
  /** Under it: the period, the annonces, the days — or nothing. */
  sub: string | null;
  /** Dinars, all taxes included; what was taken off is negative. */
  amount: number;
};

export type InvoiceLineSource = {
  /** The payment's kind (`subscription`, `listing_fee`…); null when unknown. */
  kind: string | null;
  /** What was paid, in dinars. */
  amount: number;
  /** The invoice's label: the product's name as it was when it was issued. */
  label: string;
  /** The payment's metadata, as stored. */
  metadata: Record<string, unknown> | null;
};

/** The words, from `invoice.lines` in messages/{fr,ar}.json. */
export type InvoiceLineWords = (
  key: "plan" | "period" | "days" | "quota" | "discount" | "previousPlan",
  values?: Record<string, string | number>,
) => string;

export type InvoiceLineContext = {
  locale: string;
  t: InvoiceLineWords;
  /** The period this payment bought (shop_subscriptions.payment_id): its dates when the metadata has none. */
  period?: { starts_at: string; ends_at: string } | null;
  /** The plans of the periods an upgrade replaced, by period id. */
  planNames?: Record<string, string>;
};

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function invoiceLines(src: InvoiceLineSource, ctx: InvoiceLineContext): InvoiceLine[] {
  const m = src.metadata && typeof src.metadata === "object" ? src.metadata : {};
  const { t, locale } = ctx;
  const isPlan = src.kind === "subscription";

  const from = typeof m.starts_at === "string" ? m.starts_at : ctx.period?.starts_at ?? null;
  const to = typeof m.ends_at === "string" ? m.ends_at : ctx.period?.ends_at ?? null;
  const days = num(m.duration_days);
  const quota = num(m.listing_quota);
  const sub: string[] = [];
  if (from && to) sub.push(t("period", { from: formatDate(from, locale, "medium"), to: formatDate(to, locale, "medium") }));
  else if (days && days > 0) sub.push(t("days", { count: days }));
  if (isPlan && quota && quota > 0) sub.push(t("quota", { count: quota }));

  // The list price when the checkout quoted one; what was paid otherwise.
  const listPrice = num(m.list_price);
  const price = listPrice != null && listPrice >= src.amount ? listPrice : src.amount;
  const lines: InvoiceLine[] = [{ label: isPlan ? t("plan", { name: src.label }) : src.label, sub: sub.join(" · ") || null, amount: price }];

  const discount = price - src.amount;
  if (discount <= 0) return lines;

  // What was taken off, period by period (planChange.ts credit_lines). Each
  // line was rounded down on its own and the discount as a whole as well, so
  // the last line takes the odd dinar: the lines add up to what was paid.
  const raw = Array.isArray(m.credit_lines) ? (m.credit_lines as unknown[]) : [];
  const credits = raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({ periodId: typeof l.periodId === "string" ? l.periodId : "", days: num(l.days) ?? 0, amount: num(l.amount) ?? 0 }))
    .filter((l) => l.amount > 0);
  if (credits.length === 0) credits.push({ periodId: "", days: 0, amount: discount });
  const sum = credits.reduce((n, l) => n + l.amount, 0);
  credits[credits.length - 1].amount += discount - sum;

  for (const c of credits) {
    if (c.amount <= 0) continue;
    const name = (c.periodId && ctx.planNames?.[c.periodId]) || t("previousPlan");
    lines.push({ label: t("discount", { name }), sub: c.days > 0 ? t("days", { count: c.days }) : null, amount: -c.amount });
  }
  return lines;
}

/** The period ids an upgrade's discount names — to look their plans up. */
export function creditedPeriodIds(metadata: Record<string, unknown> | null): string[] {
  const raw = metadata && Array.isArray(metadata.credit_lines) ? (metadata.credit_lines as unknown[]) : [];
  return raw
    .map((l) => (l && typeof l === "object" ? (l as { periodId?: unknown }).periodId : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
