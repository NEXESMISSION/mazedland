import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatDate, formatTND } from "@/lib/utils";
import { isUuid } from "@/lib/uuid";
import { CheckCircle2, ArrowRight, Loader2, Undo2, XCircle } from "lucide-react";
import { PaySubmitButton } from "@/components/payments/PaySubmitButton";
import { Ltr } from "@/components/ui/Ltr";
import { SuccessAutoRedirect } from "./SuccessAutoRedirect";
import { safeInternalPath } from "@/lib/safePath";

export const dynamic = "force-dynamic";

/** The tab's title: the page carried the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("payment.success");
  return { title: t("pageTitle") };
}

// The kinds a payment can have today (DB enum payment_kind). The labels this
// map used to hold — caution, achat finalisé, paiement final, inspection —
// described the auction product, and none of the five kinds below was in it:
// every real payment fell through to the generic "Paiement reçu".
// Their words: `payment.success.kind.*` (headline) and `kindBody.*`.
const KINDS = new Set(["listing_fee", "renewal", "promo", "listing_pack", "badge"]);

/** Statuses with a label under `payment.success.status`. */
const STATUSES = new Set(["pending", "pending_review", "captured", "failed", "refunded"]);

/** Where each kind of payment leaves the payer once it is confirmed. */
function destinationFor(kind: string): string {
  return kind === "listing_pack" || kind === "badge" ? "/account/payments" : "/account/listings";
}

/**
 * Post-payment confirmation page. Shows the transaction summary and
 * auto-redirects to the return URL passed by the initiating endpoint, or to
 * the seller's listings.
 *
 * WHAT WAS BROKEN. The payment was read with `select(..., auction_id)`, and
 * `payments.auction_id` was dropped with the auction product. PostgREST refuses
 * a whole request that names a missing column, so every lookup came back empty
 * and every real payment landed on "Reçu introuvable" — the one page a payer is
 * sent to after paying told them their payment did not exist.
 *
 * The page is server-side so the TX details are loaded with no client
 * round-trip. The auto-redirect is a small client component that fires
 * after 1.8s — fast enough to feel snappy, slow enough to read.
 *
 * A payment that did not go through is one of three things, and the page
 * says which (the QA tour, 2026-10-30): a receipt an admin refused (there is
 * a reviewer — a new receipt is sent from the checkout), a payment the seller
 * cancelled before sending one (no reviewer — buy again from where it
 * started), or a payment refunded by a credit note. Every one of them read
 * « Votre reçu n'a pas été validé » before, and a refund span a spinner.
 */
export default async function PaymentSuccess({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[]; return?: string | string[] }>;
}) {
  // ?id=a&id=b arrives as an array; every read below expects a string.
  const rawParams = await searchParams;
  const id = Array.isArray(rawParams.id) ? rawParams.id[0] : rawParams.id;
  const returnUrl = Array.isArray(rawParams.return) ? rawParams.return[0] : rawParams.return;
  const locale = await getLocale();
  const t = await getTranslations("payment.success");
  // `startsWith("/")` alone let `?return=//evil.example` through — a
  // protocol-relative URL, auto-followed by SuccessAutoRedirect below.
  const safeReturn = safeInternalPath(returnUrl, "/account/payments");

  // No id → bare success state (rare, but possible if a webhook lands
  // and the user followed a return URL that didn't carry the id).
  if (!id) {
    return (
      <SuccessShell
        title={t("receivedTitle")}
        body={t("receivedBody")}
        returnUrl={safeReturn}
        back={t("back")}
      />
    );
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Anonymous landing on /payment/success — sketchy but not necessarily
    // wrong (provider redirected with stale session). Bounce to /login
    // with the return URL preserved so the user lands back here after
    // signing in.
    redirect(`/${locale}/login?next=${encodeURIComponent(`/payment/success?id=${id}`)}`);
  }

  // A malformed id is no payment; asking Postgres would only log a cast error.
  const { data: payment } = isUuid(id)
    ? await supabase
        .from("payments")
        .select("id, kind, amount, status, currency, created_at, metadata, reviewer_id")
        .eq("id", id)
        .maybeSingle()
    : { data: null };

  if (!payment) {
    return (
      <SuccessShell
        title={t("notFoundTitle")}
        body={t("notFoundBody")}
        returnUrl={safeReturn}
        back={t("back")}
        refLine={t.rich("refLine", { id, ref: (chunks) => <Ltr>{chunks}</Ltr> })}
      />
    );
  }

  const kind = payment.kind as string;
  const status = payment.status as string;
  const isCaptured = status === "captured";
  const isRefunded = status === "refunded";
  // A refused receipt carries the admin who refused it; a payment the seller
  // cancelled (or one replaced by another choice) was never reviewed.
  const isRejected = status === "failed" && payment.reviewer_id != null;
  const isCancelled = status === "failed" && payment.reviewer_id == null;
  const isFailed = isRejected || isCancelled;

  const kindLabel = KINDS.has(kind) ? t(`kind.${kind}`) : t("receivedTitle");
  const subLabel = KINDS.has(kind) ? t(`kindBody.${kind}`) : t("defaultBody");
  const title = isRejected ? t("failedTitle") : isCancelled ? t("cancelledTitle") : isRefunded ? t("refundedTitle") : kindLabel;
  const body = isRejected ? t("failedBody") : isCancelled ? t("cancelledBody") : isRefunded ? t("refundedBody") : subLabel;
  const eyebrow = isCaptured
    ? t("eyebrowConfirmed")
    : isRejected
      ? t("eyebrowRejected")
      : isCancelled
        ? t("eyebrowCancelled")
        : isRefunded
          ? t("eyebrowRefunded")
          : t("eyebrowWaiting");
  // Every payment is in dinars; say so in the reader's language.
  const tc = await getTranslations("common");
  const currency =
    payment.currency === "TND" || !payment.currency ? tc("tnd") : (payment.currency as string);
  const meta = (payment.metadata ?? {}) as { listing_id?: string; shop_id?: string };
  const listingId = isUuid(meta.listing_id) ? meta.listing_id : null;
  const shopId = isUuid(meta.shop_id) ? meta.shop_id : null;
  const dest = safeInternalPath(returnUrl, destinationFor(kind)) as `/${string}`;

  // The credit note that refunded it (0187), to open from here.
  let creditNoteId: string | null = null;
  if (isRefunded) {
    const service = getServiceSupabase();
    const { data: inv } = service
      ? await service.from("invoices").select("id").eq("payment_id", payment.id).maybeSingle()
      : { data: null };
    const { data: note } = service && inv
      ? await service.from("invoices").select("id").eq("credits_invoice_id", inv.id).maybeSingle()
      : { data: null };
    creditNoteId = (note?.id as string | undefined) ?? null;
  }

  // What the payer can do from here. A refused receipt: send another one. A
  // cancelled purchase: start it again where it is bought — the annonce's
  // placement page, the agence's plan tab, or (a fee) the annonce itself.
  // « Payer à nouveau » used to re-submit the annonce of ANY failed payment,
  // which a placement's annonce — already online — refused with a 409.
  const retryHref =
    isRejected
      ? `/payment/checkout?payment=${payment.id}`
      : isCancelled && kind === "promo" && listingId
        ? `/account/listings/${listingId}/mise-en-avant`
        : isCancelled && kind === "subscription" && shopId
          ? `/pro/dashboard?shop=${shopId}&tab=abonnement`
          : null;
  const retryLabel = isRejected ? t("resendReceipt") : kind === "promo" ? t("buyAgain") : t("choosePlan");
  const resubmit = isCancelled && (kind === "listing_fee" || kind === "renewal") && listingId;

  const iconTone = isCaptured
    ? "bg-emerald-500 text-white shadow-[0_0_30px_rgba(16,185,129,0.4)]"
    : isRejected
      ? "bg-red-500/15 text-red-700 ring-1 ring-red-500/40"
      : isCancelled || isRefunded
        ? "bg-surface-2 text-muted ring-1 ring-border"
        : "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/40";
  const chipTone = isCaptured
    ? "mazed-tone-ok"
    : isRejected
      ? "mazed-tone-bad"
      : isCancelled || isRefunded
        ? "bg-surface-2 text-muted ring-1 ring-border"
        : "mazed-tone-warn";
  const chipLabel = isCancelled ? t("status.cancelled") : STATUSES.has(status) ? t(`status.${status}`) : status;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--desktop-nav-h))] w-full max-w-md flex-col items-center justify-center px-4 py-10">
      <SuccessAutoRedirect to={dest} delayMs={1800} enabled={isCaptured} />
      <div className="w-full rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-7 text-center shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        {/* Big tick */}
        <div className="relative mx-auto h-16 w-16">
          {isCaptured && (
            <div
              className="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping"
              aria-hidden
            />
          )}
          <div className={`relative h-16 w-16 rounded-full flex items-center justify-center ${iconTone}`}>
            {isCaptured ? (
              <CheckCircle2 className="h-9 w-9" strokeWidth={2.2} />
            ) : isFailed ? (
              <XCircle className="h-9 w-9" strokeWidth={2.2} />
            ) : isRefunded ? (
              <Undo2 className="h-8 w-8" strokeWidth={2.2} />
            ) : (
              <Loader2 className="h-7 w-7 animate-spin" />
            )}
          </div>
        </div>

        <div className="mt-5 text-[10px] uppercase tracking-[0.18em] font-extrabold text-[var(--gold)]">
          {eyebrow}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm text-[var(--foreground-muted)] leading-relaxed">
          {body}
        </p>

        {retryHref && (
          <div className="mt-5">
            <Link href={retryHref as `/${string}`} className="mazed-btn-luxe tap-target flex w-full items-center justify-center gap-1.5 px-3 py-2.5 text-[12.5px]">
              {retryLabel}
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </div>
        )}
        {resubmit && (
          <div className="mt-5">
            <PaySubmitButton listingId={resubmit} block label={t("payAgain")} />
          </div>
        )}
        {isRefunded && creditNoteId && (
          <div className="mt-5">
            <Link
              href={`/factures/${creditNoteId}` as `/${string}`}
              className="inline-flex items-center justify-center gap-2 w-full h-11 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px] hover:border-[var(--gold-soft)] transition-colors"
            >
              {t("viewCreditNote")}
            </Link>
          </div>
        )}

        {/* TX details */}
        <dl className="mt-6 space-y-2 rounded-[var(--radius)] bg-[var(--surface-2)] p-4 text-start">
          <Row label={t("amount")}>
            <span className="mazed-tabular font-bold gradient-gold-text">
              {formatTND(Number(payment.amount), locale)} {currency}
            </span>
          </Row>
          <Row label={t("reference")}>
            <Ltr className="font-mono text-[11px] text-foreground">
              {payment.id.slice(0, 8)}…{payment.id.slice(-4)}
            </Ltr>
          </Row>
          <Row label={t("date")}>
            <span className="font-mono text-[11px] text-foreground">
              {formatDate(payment.created_at, locale, "dateTime")}
            </span>
          </Row>
          <Row label={t("statusLabel")}>
            {/* Light-theme tones. `text-emerald-300` / `text-amber-300` were
                chosen for a dark page and sat at ~1.6:1 on this one. */}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${chipTone}`}>
              {chipLabel}
            </span>
          </Row>
        </dl>

        {/* Auto-redirect notice + manual CTA */}
        {isCaptured ? (
          <>
            <p className="mt-5 text-[11px] text-[var(--foreground-subtle)] inline-flex items-center justify-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("redirecting")}
            </p>
            {/* The primary button, not a gold gradient with black ink: with
                the ink palette `--gold` is #27272a, so that was black text on
                a near-black fill. */}
            <Link
              href={dest}
              className="mazed-btn-luxe mt-3 w-full h-12 text-[14px]"
            >
              {t("continue")}
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
            </Link>
          </>
        ) : (
          <Link
            href={dest}
            className="mt-5 inline-flex items-center justify-center gap-2 w-full h-12 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[14px] hover:border-[var(--gold-soft)] transition-colors"
          >
            {t("back")}
          </Link>
        )}
      </div>
    </div>
  );
}

function SuccessShell({
  title,
  body,
  returnUrl,
  back,
  refLine,
}: {
  title: string;
  body: string;
  returnUrl: string;
  back: string;
  /** « Réf · <id> », when there is a payment id to quote to support. */
  refLine?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--desktop-nav-h))] w-full max-w-md flex-col items-center justify-center px-4 py-10">
      <div className="w-full rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-7 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-[var(--gold-faint)] flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7 text-[var(--gold)]" />
        </div>
        <h1 className="mt-4 text-xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-[var(--foreground-muted)]">{body}</p>
        {refLine && (
          <p className="mt-3 font-mono text-[10px] text-[var(--foreground-subtle)]">
            {refLine}
          </p>
        )}
        <Link
          href={returnUrl as `/${string}`}
          className="mt-5 inline-flex items-center justify-center gap-2 w-full h-11 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px] hover:border-[var(--gold-soft)] transition-colors"
        >
          {back}
        </Link>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <dt className="text-[10px] uppercase tracking-[0.14em] font-bold text-[var(--foreground-muted)]">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
