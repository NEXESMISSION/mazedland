import { Fragment } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";
import {
  ShieldCheck,
  ClipboardCheck,
  Wallet,
  ChevronRight,
  ChevronLeft,
  Building2,
  LayoutGrid,
  LayoutDashboard,
  Briefcase,
  UserCog,
  ArrowRight,
  ArrowUpRight,
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
                href="/properties"
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
  const kycHref =
    kycStatus === "verified" || kycStatus === "submitted" || kycStatus === "pending"
      ? "/kyc/status"
      : "/kyc/start";

  const primaryActions: ActionItem[] = [
    {
      href: kycHref,
      Icon: ShieldCheck,
      title: t("sections.kyc"),
      body: kycStatus === "verified" ? "Identité vérifiée" : t("sections.kycBody"),
    },
    { href: "/sell", Icon: Building2, title: "Tableau du vendeur", body: "Vos annonces, revenus et retraits." },
    { href: "/account/activity", Icon: LayoutGrid, title: "Mes activités", body: "Enchères, acquisitions, participations et favoris." },
    { href: "/account/inspections", Icon: ClipboardCheck, title: t("sections.inspections"), body: t("sections.inspectionsBody") },
    { href: "/account/payments", Icon: Wallet, title: t("sections.payments"), body: t("sections.paymentsBody") },
  ];

  const roleActions: ActionItem[] = [];
  if (role === "admin") {
    roleActions.push({ href: "/admin", Icon: LayoutDashboard, title: "Console admin", body: "Validez les annonces, le KYC et les inspecteurs." });
  } else if (role === "bank" || role === "agency" || role === "bailiff") {
    roleActions.push({ href: "/partners/dashboard", Icon: Briefcase, title: "Espace partenaire", body: "Gérez votre portefeuille banque / agence." });
  } else if (role === "inspector") {
    roleActions.push({ href: "/inspector", Icon: ClipboardCheck, title: "Espace inspecteur", body: "Les inspections qui vous sont assignées." });
  } else {
    roleActions.push({ href: "/inspectors/apply", Icon: UserCog, title: "Devenir inspecteur", body: "Rejoignez le réseau d'inspection terrain." });
  }

  const identity = (
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
            {role !== "individual" && <span className="batta-pill-gold">{role}</span>}
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <>
      {/* ── MOBILE / tablet (< lg) — single column, unchanged ── */}
      <div className="lg:hidden mx-auto max-w-[var(--max-w)] px-4 py-6">
        {identity}
        <section className="mt-5 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
          {primaryActions.map((a, i) => (
            <Fragment key={a.href}>
              <Row {...a} ChevronEnd={ChevronEnd} isRTL={isRTL} />
              {i < primaryActions.length - 1 && <Divider />}
            </Fragment>
          ))}
        </section>
        <section className="mt-4 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
          {roleActions.map((a) => (
            <Row key={a.href} {...a} ChevronEnd={ChevronEnd} isRTL={isRTL} />
          ))}
        </section>
        <div className="mt-5">
          <SignOutButton label="Se déconnecter" />
        </div>
      </div>

      {/* ── DESKTOP (lg+) — white profile banner + 3-col action grid ── */}
      <div className="hidden lg:block mx-auto max-w-6xl px-8 py-10">
        <section className="flex items-center gap-6 rounded-3xl bg-surface p-8 ring-1 ring-border">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[var(--gold)] text-[24px] font-extrabold text-white">
            {(fullName ?? userEmail ?? "?").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className={`text-[24px] font-extrabold tracking-tight ${isRTL ? "font-arabic" : ""}`}>
                {fullName ?? userEmail ?? ""}
              </h1>
              <KycPill status={kycStatus} />
              {role !== "individual" && <span className="batta-pill-gold">{role}</span>}
            </div>
            {fullName && userEmail && (
              <p className="mt-1 text-[13.5px] text-muted">{userEmail}</p>
            )}
          </div>
          <div className="shrink-0">
            <SignOutButton label="Se déconnecter" />
          </div>
        </section>

        <p className="batta-eyebrow mb-4 mt-8">Gérer mon compte</p>
        <div className="grid grid-cols-3 gap-4">
          {[...primaryActions, ...roleActions].map((a) => (
            <ActionTile key={a.href} {...a} isRTL={isRTL} />
          ))}
        </div>
      </div>
    </>
  );
}

type ActionItem = {
  href: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
};

/** Desktop action card — matches the mockup: blue icon badge, title +
 *  corner arrow, description; lifts with a soft blue shadow on hover. */
function ActionTile({ href, Icon, title, body, isRTL }: ActionItem & { isRTL: boolean }) {
  return (
    <Link
      href={href as `/${string}`}
      className="group rounded-2xl bg-surface p-6 ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-gold-soft/60 hover:shadow-[0_12px_30px_-14px_rgba(30,58,138,0.35)]"
    >
      <span className="mb-5 inline-flex size-11 items-center justify-center rounded-2xl bg-gold-faint text-gold">
        <Icon className="size-5" strokeWidth={2} />
      </span>
      <div className="flex items-center justify-between gap-2">
        <h3 className={`text-[17px] font-bold leading-tight text-foreground ${isRTL ? "font-arabic" : ""}`}>
          {title}
        </h3>
        <ArrowUpRight className="size-4 shrink-0 text-muted transition group-hover:text-gold" strokeWidth={2} />
      </div>
      <p className="mt-1 text-[13px] leading-snug text-muted">{body}</p>
    </Link>
  );
}

function KycPill({ status }: { status: string }) {
  const tone =
    status === "verified" ? "batta-tone-ok"
    : status === "submitted" || status === "pending" ? "batta-tone-warn"
    : status === "rejected" ? "batta-tone-bad"
    : "bg-surface-2 text-muted border border-border";
  const label =
    status === "verified" ? "Identité vérifiée"
    : status === "submitted" ? "En cours de vérification"
    : status === "pending" ? "Vérification en attente"
    : status === "rejected" ? "Vérification refusée"
    : "Vérification requise";
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
