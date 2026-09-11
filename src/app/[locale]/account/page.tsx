import { Fragment } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { DeleteAccountButton } from "@/components/account/DeleteAccountButton";
import { SmsNotificationsToggle } from "@/components/account/SmsNotificationsToggle";
import {
  Wallet,
  ChevronRight,
  ChevronLeft,
  LayoutDashboard,
  ArrowRight,
  ArrowUpRight,
  FileText,
  Heart,
  Plus,
} from "lucide-react";

// Per-user, auth-gated — never static (env-less prerender would throw + fail the build).
export const dynamic = "force-dynamic";

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
  let role: string = "individual";
  let smsEnabled = true;

  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      userEmail = user.email ?? null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role, sms_notifications_enabled")
        .eq("id", user.id)
        .single();
      fullName = profile?.full_name ?? null;
      role = profile?.role ?? "individual";
      smsEnabled = profile?.sms_notifications_enabled ?? true;
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
            className="mazed-gradient-blob mazed-gradient-blob-lg absolute -left-1/3 -top-1/4 -z-10 opacity-20"
          />

          <div className="relative overflow-hidden rounded-3xl bg-surface ring-1 ring-border shadow-[var(--shadow-md)]">
            {/* Top gold accent strip. */}
            <div aria-hidden className="mazed-gradient-gold h-[2px] w-full" />

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
                  Connectez-vous pour continuer.
                </p>
              </div>

              <div className="mt-7 flex flex-col gap-2.5">
                <Link
                  href="/signup"
                  className="mazed-btn-luxe tap-target w-full px-6 py-3 text-[14px]"
                >
                  {t("signup")}
                </Link>
                <Link
                  href="/login"
                  className="mazed-btn-ghost-gold tap-target w-full px-6 py-3 text-[14px]"
                >
                  {t("login")}
                </Link>
              </div>
            </div>

            <div className="border-t border-border bg-surface-2 px-7 py-4 text-center sm:px-8">
              <Link
                href="/annonces"
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
  //
  // WHAT STOOD HERE. Three groups built for the auction product: identity
  // verification (KYC), a role space for inspectors, banks and agencies, an
  // "Acheteur" group of bids and inspections, and a seller dashboard at /sell.
  // KYC, the inspector network, the partner portal, inspections and /sell are
  // all retired — next.config sends every one of those paths somewhere else —
  // so on the page a signed-in user lands on, five of the seven rows led
  // nowhere they had asked to go. What remains is what the product does.
  const accountActions: ActionItem[] = [
    { href: "/account/listings", Icon: FileText, title: "Mes annonces", body: "Brouillons, annonces publiées et expirées." },
    { href: "/annonces/nouvelle", Icon: Plus, title: "Publier une annonce", body: "Terrain, maison, appartement ou local." },
    { href: "/account/activity", Icon: Heart, title: "Mes favoris", body: "Les annonces que vous avez enregistrées." },
    { href: "/account/payments", Icon: Wallet, title: "Mes paiements", body: "Frais de publication, options et reçus." },
  ];
  if (role === "admin") {
    accountActions.push({ href: "/admin", Icon: LayoutDashboard, title: "Console admin", body: "Annonces, paiements et vendeurs." });
  }
  const groups: { label: string; items: ActionItem[] }[] = [
    { label: "Mon espace", items: accountActions },
  ];

  const identity = (
    <section className="mazed-surface-navy-luxe relative overflow-hidden rounded-2xl p-6 ring-1 ring-gold/25">
      <div className="flex items-start gap-3">
        <span className="mazed-monogram mazed-monogram-filled size-12 shrink-0 text-[20px] font-extrabold">
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
          {role === "admin" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="mazed-pill-gold">Administrateur</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <>
      {/* ── MOBILE / tablet (< lg) — single column, unchanged ── */}
      <div className="lg:hidden mx-auto max-w-[var(--max-w)] px-4 py-6">
        {identity}
        {groups.map((g) => (
          <section key={g.label} className="mt-5">
            <p className="mazed-eyebrow mb-2">{g.label}</p>
            <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
              {g.items.map((a, i) => (
                <Fragment key={a.href}>
                  <Row {...a} ChevronEnd={ChevronEnd} isRTL={isRTL} />
                  {i < g.items.length - 1 && <Divider />}
                </Fragment>
              ))}
            </div>
          </section>
        ))}
        <section className="mt-5">
          <p className="mazed-eyebrow mb-2">Notifications</p>
          <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
            <SmsNotificationsToggle initial={smsEnabled} />
          </div>
        </section>
        <div className="mt-6">
          <SignOutButton label="Se déconnecter" />
        </div>
        <div className="mt-2">
          <DeleteAccountButton label="Supprimer mon compte" />
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
              {role === "admin" && <span className="mazed-pill-gold">Administrateur</span>}
            </div>
            {fullName && userEmail && (
              <p className="mt-1 text-[13.5px] text-muted">{userEmail}</p>
            )}
          </div>
          <div className="shrink-0">
            <SignOutButton label="Se déconnecter" />
          </div>
        </section>

        {groups.map((g) => (
          <div key={g.label} className="mt-8">
            <p className="mazed-eyebrow mb-4">{g.label}</p>
            <div className="grid grid-cols-3 gap-4">
              {g.items.map((a) => (
                <ActionTile key={a.href} {...a} isRTL={isRTL} />
              ))}
            </div>
          </div>
        ))}
        <div className="mt-8">
          <p className="mazed-eyebrow mb-4">Notifications</p>
          <div className="max-w-xl overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
            <SmsNotificationsToggle initial={smsEnabled} />
          </div>
        </div>
        <div className="mt-10 max-w-sm">
          <DeleteAccountButton label="Supprimer mon compte" />
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

/** Desktop action card — icon badge, title + corner arrow, description;
 *  lifts with a soft shadow on hover. */
function ActionTile({ href, Icon, title, body, isRTL }: ActionItem & { isRTL: boolean }) {
  return (
    <Link
      href={href as `/${string}`}
      className="group rounded-2xl bg-surface p-6 ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-gold-soft/60 hover:shadow-[var(--shadow-md)]"
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
