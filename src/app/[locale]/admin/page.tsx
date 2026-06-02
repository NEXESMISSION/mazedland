import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  Building2, Receipt, Banknote, Wallet, UserCheck,
  AlertTriangle, ArrowUpRight, CalendarClock,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin triage dashboard — the work-queue cockpit. Instead of dumping the
 * admin into a list, it shows per-queue backlog counts, how many are
 * overdue (> 48 h waiting), and today's intake, each tile linking straight
 * into the pre-filtered queue. Built for "hundreds of sales/day": every
 * number is a server-side COUNT (head-only), never a fetched list.
 */
const OVERDUE_MS = 48 * 3_600_000;
const ENTRY_KINDS = ["deposit_lock", "buy_now", "final_payment"];

export default async function AdminDashboard() {
  const sb = await getServerSupabase();
  const overdue = new Date(Date.now() - OVERDUE_MS).toISOString();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const today = dayStart.toISOString();

  const head = (t: string) => sb.from(t).select("*", { count: "exact", head: true });

  const [
    propsPending, propsOverdue, propsToday,
    feePending,
    entryPending, entryOverdue, entryToday,
    refundPending, refundOverdue,
    payoutPending, payoutOverdue,
    kycPending,
  ] = await Promise.all([
    head("properties").eq("status", "pending_review"),
    head("properties").eq("status", "pending_review").lt("created_at", overdue),
    head("properties").eq("status", "pending_review").gte("created_at", today),
    head("payments").eq("status", "pending_review").eq("kind", "listing_fee"),
    head("payments").eq("status", "pending_review").in("kind", ENTRY_KINDS),
    head("payments").eq("status", "pending_review").in("kind", ENTRY_KINDS).lt("receipt_uploaded_at", overdue),
    head("payments").eq("status", "pending_review").in("kind", ENTRY_KINDS).gte("receipt_uploaded_at", today),
    head("auction_deposits").not("released_at", "is", null).is("refunded_at", null).is("forfeited_at", null),
    head("auction_deposits").not("released_at", "is", null).is("refunded_at", null).is("forfeited_at", null).lt("released_at", overdue),
    head("seller_payouts").eq("status", "requested"),
    head("seller_payouts").eq("status", "requested").lt("created_at", overdue),
    head("kyc_submissions").eq("status", "submitted"),
  ]);

  const n = (r: { count: number | null }) => r.count ?? 0;
  const tiles = [
    { label: "Création d'enchères", href: "/admin/properties", Icon: Building2, count: n(propsPending), overdue: n(propsOverdue), sub: `${n(feePending)} reçu(s) de création` },
    { label: "Paiements", href: "/admin/payments", Icon: Receipt, count: n(entryPending), overdue: n(entryOverdue), sub: "Caution · achat · solde" },
    { label: "Remboursements", href: "/admin/deposits", Icon: Banknote, count: n(refundPending), overdue: n(refundOverdue), sub: "Cautions des non-gagnants" },
    { label: "Paiements vendeurs", href: "/admin/payouts", Icon: Wallet, count: n(payoutPending), overdue: n(payoutOverdue), sub: "Retraits demandés" },
    { label: "KYC", href: "/admin/kyc-queue", Icon: UserCheck, count: n(kycPending), overdue: 0, sub: "Identités à vérifier" },
  ];

  const totalPending = tiles.reduce((s, t) => s + t.count, 0);
  const totalOverdue = tiles.reduce((s, t) => s + t.overdue, 0);
  const todayIntake = n(propsToday) + n(entryToday);

  return (
    <div>
      <AdminPageHeader
        eyebrow="Console"
        title="Tableau de bord"
        description="Tout ce qui attend une décision, par file. Cliquez une carte pour traiter."
      />

      {/* Top KPIs */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="En attente" value={totalPending} tone="brand" />
        <Kpi label="En retard (> 48 h)" value={totalOverdue} tone={totalOverdue > 0 ? "danger" : "muted"} Icon={AlertTriangle} />
        <Kpi label="Reçu aujourd'hui" value={todayIntake} tone="muted" Icon={CalendarClock} />
      </div>

      {/* Queue tiles */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href as "/admin/properties"}
            className="group rounded-2xl bg-surface p-5 ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-gold-soft/60 hover:shadow-[0_12px_30px_-14px_rgba(30,58,138,0.35)]"
          >
            <div className="flex items-start justify-between">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-muted transition group-hover:text-gold">
                <t.Icon className="size-5" strokeWidth={2} />
              </span>
              <ArrowUpRight className="size-4 text-muted transition group-hover:text-gold" strokeWidth={2} />
            </div>
            <div className="batta-tabular mt-4 text-[32px] font-extrabold leading-none text-foreground">
              {t.count}
            </div>
            <div className="mt-1.5 text-[14px] font-bold leading-tight text-foreground">{t.label}</div>
            <div className="mt-0.5 text-[11.5px] text-muted">{t.sub}</div>
            {t.overdue > 0 && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600 ring-1 ring-red-200">
                <AlertTriangle className="size-3" strokeWidth={2.4} />
                {t.overdue} en retard
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Kpi({
  label, value, tone, Icon,
}: {
  label: string;
  value: number;
  tone: "brand" | "danger" | "muted";
  Icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  const numClass = tone === "danger" ? "text-red-600" : tone === "brand" ? "text-gold" : "text-foreground";
  return (
    <div className="rounded-2xl bg-surface p-5 ring-1 ring-border">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        {Icon && <Icon className="size-3.5" strokeWidth={2.2} />}
        {label}
      </div>
      <div className={`batta-tabular mt-2 text-[34px] font-extrabold leading-none ${numClass}`}>
        {value.toLocaleString("fr-FR")}
      </div>
    </div>
  );
}
