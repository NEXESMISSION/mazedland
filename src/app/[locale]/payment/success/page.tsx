import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatDate, formatTND } from "@/lib/utils";
import { CheckCircle2, ArrowRight, Loader2, XCircle } from "lucide-react";
import { PaySubmitButton } from "@/components/payments/PaySubmitButton";
import { Ltr } from "@/components/ui/Ltr";
import { SuccessAutoRedirect } from "./SuccessAutoRedirect";
import { safeInternalPath } from "@/lib/safePath";

export const dynamic = "force-dynamic";

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

  const { data: payment } = await supabase
    .from("payments")
    .select("id, kind, amount, status, currency, created_at, metadata")
    .eq("id", id)
    .maybeSingle();

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
  const kindLabel = KINDS.has(kind) ? t(`kind.${kind}`) : t("receivedTitle");
  const subLabel = KINDS.has(kind) ? t(`kindBody.${kind}`) : t("defaultBody");
  const status = payment.status as string;
  // Every payment is in dinars; say so in the reader's language.
  const tc = await getTranslations("common");
  const currency =
    payment.currency === "TND" || !payment.currency ? tc("tnd") : (payment.currency as string);
  const isCaptured = payment.status === "captured";
  // A refused receipt (or a cancelled payment) used to land here and read
  // « Frais de publication réglés » under a spinner that never stopped.
  const isFailed = payment.status === "failed";
  const listingId =
    (payment.metadata as { listing_id?: string } | null)?.listing_id ?? null;
  const dest = safeInternalPath(returnUrl, destinationFor(payment.kind as string)) as `/${string}`;

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
          <div
            className={`relative h-16 w-16 rounded-full flex items-center justify-center ${
              isCaptured
                ? "bg-emerald-500 text-white shadow-[0_0_30px_rgba(16,185,129,0.4)]"
                : isFailed
                  ? "bg-red-500/15 text-red-700 ring-1 ring-red-500/40"
                  : "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/40"
            }`}
          >
            {isCaptured ? (
              <CheckCircle2 className="h-9 w-9" strokeWidth={2.2} />
            ) : isFailed ? (
              <XCircle className="h-9 w-9" strokeWidth={2.2} />
            ) : (
              <Loader2 className="h-7 w-7 animate-spin" />
            )}
          </div>
        </div>

        <div className="mt-5 text-[10px] uppercase tracking-[0.18em] font-extrabold text-[var(--gold)]">
          {isCaptured ? t("eyebrowConfirmed") : isFailed ? t("eyebrowRejected") : t("eyebrowWaiting")}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
          {kindLabel}
        </h1>
        <p className="mt-2 text-sm text-[var(--foreground-muted)] leading-relaxed">
          {isFailed ? t("failedBody") : subLabel}
        </p>

        {isFailed && listingId && (
          <div className="mt-5">
            <PaySubmitButton listingId={listingId} block label={t("payAgain")} />
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
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                isCaptured ? "mazed-tone-ok" : "mazed-tone-warn"
              }`}
            >
              {STATUSES.has(status) ? t(`status.${status}`) : status}
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
