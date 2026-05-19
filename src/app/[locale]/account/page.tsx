import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  ShieldCheck,
  ClipboardCheck,
  Wallet,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Building2,
  Trophy,
  Heart,
  LayoutDashboard,
  Briefcase,
  UserCog,
  Gavel,
  ArrowRight,
} from "lucide-react";

/**
 * Account hub — identity card on top, then grouped action rows. The
 * three group cards use the dark `surface` colour with a gold-tinted
 * hairline, the same recipe used across the redesigned public pages,
 * so the user lands here and sees the same visual system continuing.
 */
export default async function AccountPage() {
  const t = await getTranslations("accountPage");
  const locale = await getLocale();
  const isRTL = locale === "ar";
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  // Fail-soft: Supabase env missing in dev → render guest banner. Real
  // sign-in flow needs env configured.
  let userId: string | null = null;
  let userEmail: string | null = null;
  let fullName: string | null = null;
  let kycStatus: string = "none";
  let role: string = "individual";

  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      userEmail = user.email ?? null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, kyc_status, role")
        .eq("id", user.id)
        .single();
      fullName = profile?.full_name ?? null;
      kycStatus = profile?.kyc_status ?? "none";
      role = profile?.role ?? "individual";
    }
  } catch {
    // env missing — fall through to guest UI.
  }

  if (!userId) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-[var(--max-w)] flex-col items-center justify-center px-6">
        <div className="relative w-full max-w-sm">
          {/* Ambient gold blob behind the card, very low opacity. */}
          <div
            aria-hidden
            className="batta-gradient-blob batta-gradient-blob-lg absolute -left-1/3 -top-1/4 -z-10 opacity-20"
          />

          <div className="relative overflow-hidden rounded-3xl bg-surface ring-1 ring-border shadow-[var(--shadow-md)]">
            {/* Top gold accent strip. */}
            <div aria-hidden className="batta-gradient-gold h-[2px] w-full" />

            <div className="p-7 sm:p-8">
              <div className="flex flex-col items-center text-center">
                <h1
                  className={`text-[24px] font-extrabold leading-[1.1] tracking-tight ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  <span className="gradient-gold-text">{t("guestTitle")}</span>
                </h1>
                <p className="mt-2 text-[12.5px] text-muted">
                  Connectez-vous pour gérer vos enchères et votre profil.
                </p>
              </div>

              <div className="mt-7 flex flex-col gap-2.5">
                <Link
                  href="/signup"
                  className="batta-btn-luxe tap-target w-full px-6 py-3 text-[14px]"
                >
                  {t("signup")}
                </Link>
                <Link
                  href="/login"
                  className="batta-btn-ghost-gold tap-target w-full px-6 py-3 text-[14px]"
                >
                  {t("login")}
                </Link>
              </div>
            </div>

            <div className="border-t border-border bg-surface-2 px-7 py-4 text-center sm:px-8">
              <Link
                href="/auctions"
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-muted transition hover:text-gold-bright"
              >
                Explorer sans compte
                <ArrowRight
                  className={`size-3 ${isRTL ? "rotate-180" : ""}`}
                  strokeWidth={2.4}
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed-in surface.
  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]">
      {/* Identity card — gold-rimmed navy luxe surface with the user's
          initial, name, email, and KYC pill. */}
      <section className="batta-surface-navy-luxe relative overflow-hidden rounded-2xl p-6 ring-1 ring-gold/25">
        <div className="flex items-start gap-3">
          <span className="batta-monogram batta-monogram-filled size-12 shrink-0 text-[20px] font-extrabold">
            {(fullName ?? userEmail ?? "?").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className={`truncate text-[16px] font-extrabold leading-tight text-foreground ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              {fullName ?? userEmail ?? ""}
            </div>
            {fullName && userEmail && (
              <div className="mt-0.5 truncate text-[11px] text-muted">{userEmail}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <KycPill status={kycStatus} />
              {role !== "individual" && (
                <span className="batta-pill-gold">{role}</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Primary action group. */}
      <section className="mt-5 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
        <Row href="/kyc" Icon={ShieldCheck}
          title={t("sections.kyc")}
          body={kycStatus === "verified" ? "Verified" : t("sections.kycBody")}
          ChevronEnd={ChevronEnd} isRTL={isRTL} />
        <Divider />
        <Row href="/sell" Icon={Building2}
          title="My listings"
          body="Manage properties you've posted for auction."
          ChevronEnd={ChevronEnd} isRTL={isRTL} />
        <Divider />
        <Row href="/account/bids" Icon={Gavel}
          title="My bids"
          body="Auctions you're participating in."
          ChevronEnd={ChevronEnd} isRTL={isRTL} />
        <Divider />
        <Row href="/account/wins" Icon={Trophy}
          title="My wins"
          body="Auctions you've won and what to do next."
          ChevronEnd={ChevronEnd} isRTL={isRTL} />
        <Divider />
        <Row href="/watchlist" Icon={Heart}
          title="Watchlist"
          body="Saved auctions you're tracking."
          ChevronEnd={ChevronEnd} isRTL={isRTL} />
        <Divider />
        <Row href="/account/inspections" Icon={ClipboardCheck}
          title={t("sections.inspections")}
          body={t("sections.inspectionsBody")}
          ChevronEnd={ChevronEnd} isRTL={isRTL} />
        <Divider />
        <Row href="/payment/mock" Icon={Wallet}
          title={t("sections.payments")}
          body={t("sections.paymentsBody")}
          ChevronEnd={ChevronEnd} isRTL={isRTL} />
      </section>

      {/* Role-specific shortcuts. */}
      <section className="mt-4 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
        {role === "admin" && (
          <Row href="/admin" Icon={LayoutDashboard}
            title="Admin console"
            body="Approve listings, KYC, inspectors."
            ChevronEnd={ChevronEnd} isRTL={isRTL} />
        )}
        {(role === "bank" || role === "agency" || role === "bailiff") && (
          <Row href="/partners/dashboard" Icon={Briefcase}
            title="Partner dashboard"
            body="Manage your bank/agency portfolio."
            ChevronEnd={ChevronEnd} isRTL={isRTL} />
        )}
        {role === "inspector" && (
          <Row href="/inspector" Icon={ClipboardCheck}
            title="Inspector dashboard"
            body="Inspections assigned to you."
            ChevronEnd={ChevronEnd} isRTL={isRTL} />
        )}
        {role === "individual" && (
          <Row href="/inspectors/apply" Icon={UserCog}
            title="Apply as inspector"
            body="Join the on-site inspection network."
            ChevronEnd={ChevronEnd} isRTL={isRTL} />
        )}
      </section>

      {/* Sign out — POSTs to a route handler that clears the cookie and
          bounces back to the landing page. Plain form submit keeps it
          working without JS too. */}
      <form action="/api/auth/signout" method="POST" className="mt-5">
        <button
          type="submit"
          className="batta-btn-ghost-gold tap-target w-full px-5 py-3 text-[13px]"
        >
          <LogOut className="size-4" strokeWidth={2} />
          Sign out
        </button>
      </form>
    </div>
  );
}

function KycPill({ status }: { status: string }) {
  const tone =
    status === "verified" ? "batta-tone-ok"
    : status === "submitted" || status === "pending" ? "batta-tone-warn"
    : status === "rejected" ? "batta-tone-bad"
    : "bg-surface-2 text-muted border border-border";
  const label =
    status === "verified" ? "KYC verified"
    : status === "submitted" ? "KYC under review"
    : status === "pending" ? "KYC pending"
    : status === "rejected" ? "KYC rejected"
    : "KYC required";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] ${tone}`}>
      {label}
    </span>
  );
}

function Row({
  href,
  Icon,
  title,
  body,
  ChevronEnd,
  isRTL,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
  ChevronEnd: React.ComponentType<{ className?: string }>;
  isRTL: boolean;
}) {
  return (
    <Link
      href={href as `/${string}`}
      className="tap-target flex items-center gap-3 p-4 transition hover:bg-surface-2 active:bg-surface-2"
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/30">
        <Icon className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] font-bold text-foreground ${isRTL ? "font-arabic" : ""}`}>
          {title}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-muted">{body}</div>
      </div>
      <ChevronEnd className="size-5 text-muted" />
    </Link>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-border" />;
}
