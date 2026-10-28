import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { paymentReference } from "@/lib/payments";
import { loadInvoiceLines } from "@/lib/payments/invoiceLinesServer";
import type { InvoiceLine } from "@/lib/payments/invoiceLines";
import { formatDate } from "@/lib/utils";
import { Ltr } from "@/components/ui/Ltr";
import { PrintButton } from "./PrintButton";
import { getSettings } from "@/lib/settings/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoice");
  return { title: t("metaTitle"), robots: { index: false } };
}

type Invoice = {
  id: string;
  payment_id: string | null;
  user_id: string | null;
  number: string;
  doc_type: "invoice" | "receipt" | "credit_note";
  /** A credit note (0187): the invoice it cancels, and why. */
  credits_invoice_id: string | null;
  reason: string | null;
  issued_at: string;
  amount_ttc: number | string;
  vat_rate: number | string | null;
  amount_ht: number | string | null;
  vat_amount: number | string | null;
  label: string;
  issuer: { name?: string; tax_id?: string | null; address?: string | null };
  client: { name?: string | null; phone?: string | null; shop?: string | null; legal_name?: string | null; legal_id?: string | null };
};

/** Millimes, the Tunisian way: 29,000 DT. */
const dt = (v: number | string | null, locale: string) =>
  v == null ? "—" : `${Number(v).toLocaleString(locale === "ar" ? "ar-TN" : "fr-TN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

/**
 * An invoice — or, while the company's identity is not filled in, a receipt
 * (0175). What it says was fixed when it was issued. Its payer and the admins
 * may open it; « Imprimer » prints the document alone (globals.css).
 *
 * A credit note (0187) is the same page: « Facture d'avoir », the invoice it
 * cancels, the reason, the amounts negative. Its payment is the invoice's.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const t = await getTranslations("invoice");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/factures/${id}`)}`);
  const admin = getServiceSupabase();
  if (!admin || !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: row }, { data: me }] = await Promise.all([
    admin.from("invoices").select("*").eq("id", id).maybeSingle(),
    admin.from("profiles").select("role").eq("id", user!.id).maybeSingle(),
  ]);
  const inv = row as Invoice | null;
  if (!inv || (inv.user_id !== user!.id && me?.role !== "admin")) notFound();
  const isCredit = inv.doc_type === "credit_note";
  const { data: original } = isCredit && inv.credits_invoice_id
    ? await admin.from("invoices").select("id, number, issued_at, payment_id").eq("id", inv.credits_invoice_id).maybeSingle()
    : { data: null };
  // An invoice says when a credit note cancelled it.
  const { data: cancelledBy } = !isCredit
    ? await admin.from("invoices").select("id, number, issued_at").eq("credits_invoice_id", inv.id).maybeSingle()
    : { data: null };
  const paymentId = (isCredit ? original?.payment_id : inv.payment_id) as string | null;
  const { data: pay } = paymentId
    ? await admin.from("payments").select("provider, reviewed_at, created_at, kind, amount, metadata").eq("id", paymentId).maybeSingle()
    : { data: null };
  // What it is for, line by line — the plan, its period, what an upgrade took
  // off the price (invoiceLines.ts). A credit note is one line: what it cancels.
  const lines: InvoiceLine[] = !isCredit && paymentId && pay
    ? await loadInvoiceLines(
        admin,
        { id: paymentId, kind: pay.kind as string | null, amount: pay.amount as number | string, metadata: pay.metadata as Record<string, unknown> | null },
        inv.label,
        locale,
      )
    : [{ label: inv.label, sub: null, amount: Number(inv.amount_ttc) }];
  const contactEmail = (await getSettings()).contact_email;

  const isInvoice = inv.doc_type === "invoice" || isCredit;
  const hasVat = inv.vat_rate != null && inv.amount_ht != null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 lg:py-10">
      <div data-print-hide className="mb-4 flex items-center justify-between gap-3">
        <a href={`/${locale}/account/payments`} className="text-[12.5px] font-bold text-muted hover:text-foreground">{t("back")}</a>
        <PrintButton label={t("print")} />
      </div>

      <article data-print-area className="rounded-2xl bg-white p-6 text-[#18181b] shadow-sm ring-1 ring-border sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <Image src="/logo-mark.webp" alt="Mazed Immo" width={127} height={160} className="h-10 w-auto" />
            <p className="mt-3 text-[13px] font-extrabold">{inv.issuer.name ?? "Mazed Immo"}</p>
            {inv.issuer.tax_id && <p className="text-[12px]">{t("taxId")} : <Ltr>{inv.issuer.tax_id}</Ltr></p>}
            {inv.issuer.address && <p className="max-w-xs whitespace-pre-line text-[12px]">{inv.issuer.address}</p>}
            <p className="text-[12px]">www.mazed.immo · {contactEmail}</p>
          </div>
          <div className="text-end">
            <h1 className="text-[22px] font-extrabold uppercase tracking-wide">{t(isCredit ? "creditNote" : isInvoice ? "invoice" : "receipt")}</h1>
            <p className="mt-1 text-[13px] font-bold"><Ltr>{inv.number}</Ltr></p>
            <p className="text-[12px]">{t("issuedOn", { date: formatDate(inv.issued_at, locale, "long") })}</p>
          </div>
        </header>

        <section className="mt-8 rounded-xl bg-[#f4f4f5] p-4 text-[12.5px]">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[#52525b]">{t("billedTo")}</p>
          <p className="mt-1 font-bold">{inv.client.legal_name || inv.client.shop || inv.client.name || "—"}</p>
          {inv.client.legal_name && inv.client.name && <p>{inv.client.name}</p>}
          {inv.client.legal_id && <p>{t("taxId")} : <Ltr>{inv.client.legal_id}</Ltr></p>}
          {inv.client.phone && <p><Ltr>{inv.client.phone}</Ltr></p>}
        </section>

        <table className="mt-6 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-[#d4d4d8] text-start text-[11px] uppercase tracking-wide text-[#52525b]">
              <th className="py-2 text-start font-bold">{t("item")}</th>
              <th className="py-2 text-end font-bold">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-[#e4e4e7] align-top">
                <td className="py-3 pe-4" dir="auto">
                  {l.label}
                  {l.sub && <span className="mt-0.5 block text-[11.5px] text-[#52525b]">{l.sub}</span>}
                </td>
                <td className="mazed-tabular py-3 text-end">{dt(l.amount, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-[13px]">
            {hasVat && (
              <>
                <tr>
                  <td className="pt-4 text-end font-semibold">{t("totalHt")}</td>
                  <td className="mazed-tabular pt-4 text-end">{dt(inv.amount_ht, locale)}</td>
                </tr>
                <tr>
                  <td className="pt-1 text-end font-semibold">{t("vat", { rate: Number(inv.vat_rate) })}</td>
                  <td className="mazed-tabular pt-1 text-end">{dt(inv.vat_amount, locale)}</td>
                </tr>
              </>
            )}
            <tr>
              <td className="pt-3 text-end font-extrabold">{t(isCredit ? "totalCredit" : hasVat ? "ttc" : "total")}</td>
              <td className="mazed-tabular pt-3 text-end text-[15px] font-extrabold">{dt(inv.amount_ttc, locale)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="mt-8 grid gap-1 text-[12px] text-[#3f3f46]">
          {isCredit && original && (
            // What it cancels, linked: the accountant follows one to the other.
            <p className="font-semibold text-[#18181b]">
              {t("cancels")}{" "}
              <a href={`/${locale}/factures/${original.id}`} className="underline"><Ltr>{original.number}</Ltr></a>{" "}
              {t("ofDate", { date: formatDate(original.issued_at as string, locale, "long") })}
              {inv.reason && <> — {inv.reason}</>}
            </p>
          )}
          {cancelledBy && (
            <p className="font-semibold text-[#b91c1c]">
              {t("cancelledBy")}{" "}
              <a href={`/${locale}/factures/${cancelledBy.id}`} className="underline"><Ltr>{cancelledBy.number}</Ltr></a>{" "}
              {t("ofDate", { date: formatDate(cancelledBy.issued_at as string, locale, "long") })}
            </p>
          )}
          {!isCredit && (
            <p>{t("paidBy", { method: t(pay?.provider === "d17" ? "d17" : "transfer") })} · {t("paidOn", { date: formatDate((pay?.reviewed_at ?? pay?.created_at ?? inv.issued_at) as string, locale, "long") })}</p>
          )}
          {paymentId && <p>{t("reference")} : <Ltr>{paymentReference(paymentId)}</Ltr></p>}
          {!hasVat && isInvoice && <p>{t("noVat")}</p>}
          {!isInvoice && <p className="mt-2 font-semibold">{t("receiptNote")}</p>}
        </section>
      </article>
    </main>
  );
}
