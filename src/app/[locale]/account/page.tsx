import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  ShieldCheck,
  ClipboardCheck,
  Wallet,
  ChevronRight,
  ChevronLeft,
  LogIn,
  LogOut,
  Building2,
  Trophy,
  Heart,
  LayoutDashboard,
  Briefcase,
  UserCog,
  Gavel,
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
      <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]">
        <section className="batta-surface-navy-luxe relative overflow-hidden rounded-2xl p-6 ring-1 ring-gold/25">
          <span className="batta-eyebrow inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-gold pulse-gold" />
            Members area
          </span>
          <h1
            className={`mt-3 text-[24px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            <span className="gradient-gold-text">{t("guestTitle")}</span>
          </h1>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">{t("guestBody")}</p>
          <div className="mt-5 flex gap-2.5">
            <Link
              href="/login"
              className="batta-btn-luxe tap-target flex-1 px-5 py-3 text-[13.5px]"
            >
              <LogIn className="size-4" strokeWidth={2} />
              {t("login")}
            </Link>
            <Link
              href="/signup"
              className="batta-btn-ghost-gold tap-target flex-1 px-5 py-3 text-[13.5px]"
            >
              {t("signup")}
            </Link>
          </div>
        </section>
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
