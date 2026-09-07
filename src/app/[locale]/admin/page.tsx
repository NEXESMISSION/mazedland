import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminPage, EYEBROW } from "@/components/admin/kit";
import { actionLabel } from "@/lib/admin/actions";
import { AlertTriangle, ArrowRight, Gavel } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The triage dashboard — what is waiting on a decision, right now.
 *
 * Ported from Mazed Auto, with one difference that is the whole story of where
 * Land currently is. Auto's dashboard counts four classifieds queues because
 * its auction tables read zero. Land's auction product is **live** — measured
 * 2026-09-07: 18 lots running, 6 scheduled, and cautions held against them —
 * so those queues are counted first, and the classifieds pivot is reported
 * underneath as progress rather than pretended into the main figures.
 *
 * Every number is a head-only COUNT. Nothing here fetches a list except the
 * audit strip at the bottom.
 */

const OVERDUE_MS = 48 * 3_600_000;

export default async function AdminDashboard() {
  const sb = await getServerSupabase();
  const overdue = new Date(Date.now() - OVERDUE_MS).toISOString();

  const head = (t: string) => sb.from(t).select("*", { count: "exact", head: true });

  const [
    lots, lotsOverdue,
    paymentsPending, paymentsOverdue,
    cautions, cautionsOverdue,
    kyc,
    liveLots, scheduledLots,
    listingsDraft, listingsPublished,
    recent,
  ] = await Promise.all([
    head("properties").eq("status", "pending_review"),
    head("properties").eq("status", "pending_review").lt("created_at", overdue),
    head("payments").eq("status", "pending_review"),
    head("payments").eq("status", "pending_review").lt("created_at", overdue),
    // Released to us, not yet refunded or forfeited: the queue that is holding
    // other people's money.
    head("auction_deposits").not("released_at", "is", null).is("refunded_at", null).is("forfeited_at", null),
    head("auction_deposits").not("released_at", "is", null).is("refunded_at", null).is("forfeited_at", null).lt("released_at", overdue),
    head("kyc_submissions").eq("status", "submitted"),
    head("auctions").eq("status", "live"),
    head("auctions").eq("status", "scheduled"),
    head("listings").eq("status", "draft"),
    head("listings").eq("status", "published"),
    // `action is not null`, minus the telemetry namespaces: an admin opens
    // "Derniers gestes" to see who decided what, not to read render traces.
    sb.from("activity_log")
      .select("id, created_at, action, user_email")
      .not("action", "is", null)
      .not("action", "like", "client.%")
      .not("action", "like", "server.%")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const n = (r: { count: number | null }) => r.count ?? 0;

  const queues = [
    {
      label: "Biens à valider",
      sub: "Soumis par un vendeur",
      href: "/admin/properties",
      count: n(lots),
      overdue: n(lotsOverdue),
    },
    {
      label: "Reçus à valider",
      sub: "Cautions et frais de mise en vente",
      href: "/admin/payments",
      count: n(paymentsPending),
      overdue: n(paymentsOverdue),
    },
    {
      label: "Cautions à rembourser",
      sub: "Enchérisseurs non retenus",
      href: "/admin/deposits",
      count: n(cautions),
      overdue: n(cautionsOverdue),
    },
    {
      label: "Identités à vérifier",
      sub: "KYC en attente",
      href: "/admin/kyc-queue",
      count: n(kyc),
      overdue: 0,
    },
  ];

  const totalPending = queues.reduce((s, q) => s + q.count, 0);
  const totalOverdue = queues.reduce((s, q) => s + q.overdue, 0);

  return (
    <AdminPage>
      <header>
        <span className={EYEBROW}>Console</span>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">
          Tableau de bord
        </h1>
      </header>

      <div className="mt-7 grid grid-cols-3 border-y border-border">
        <Figure label="En attente" value={totalPending} accent={totalPending > 0} />
        <Figure
          label="En retard > 48 h"
          value={totalOverdue}
          danger={totalOverdue > 0}
          className="border-s border-border"
        />
        <Figure
          label="Lots en cours"
          value={n(liveLots) + n(scheduledLots)}
          className="border-s border-border"
        />
      </div>

      <section className="mt-9">
        <h2 className={EYEBROW}>Files</h2>
        <ul className="mt-2 border-t border-border">
          {queues.map((qq) => (
            <li key={qq.href}>
              <Link
                href={qq.href as "/admin/properties"}
                className="group flex items-center gap-4 border-b border-border py-3 transition hover:bg-[var(--row-hover)]"
              >
                <span
                  className={`batta-tabular w-10 shrink-0 text-end text-[19px] font-semibold ${
                    qq.count > 0 ? "text-foreground" : "text-subtle"
                  }`}
                >
                  {qq.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {qq.label}
                  </span>
                  <span className="block truncate text-[11.5px] text-subtle">{qq.sub}</span>
                </span>
                {qq.overdue > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[var(--tone-bad)]">
                    <AlertTriangle className="size-3" strokeWidth={2.6} />
                    {qq.overdue} en retard
                  </span>
                )}
                <ArrowRight
                  className="size-3.5 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-[var(--gold)]"
                  strokeWidth={2}
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* The pivot's own progress, on the screen that gets opened every day.
          The fixed-price catalogue exists but nothing publishes into it yet —
          saying so here beats discovering it from an empty page. */}
      <section className="mt-9 border-s-2 border-[var(--gold)] ps-4">
        <h2 className={`${EYEBROW} text-[var(--gold)]`}>Bascule en cours</h2>
        <p className="mt-1.5 max-w-xl text-[12.5px] text-subtle">
          Le catalogue à prix affiché existe :{" "}
          <span className="font-semibold text-foreground">
            {n(listingsPublished)} publiée(s)
          </span>{" "}
          et{" "}
          <span className="font-semibold text-foreground">
            {n(listingsDraft)} en brouillon
          </span>
          . La file de modération et le moteur de prix arrivent aux phases suivantes ; jusque-là
          les enchères ci-dessus restent le produit vivant.
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-subtle">
          <Gavel className="size-3" strokeWidth={2.2} />
          {n(liveLots)} en cours · {n(scheduledLots)} programmés · {n(cautions)} caution(s) à solder
        </p>
      </section>

      <section className="mt-9">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className={EYEBROW}>Derniers gestes</h2>
          <Link
            href={"/admin/activity" as "/admin"}
            className="text-[11.5px] font-medium text-subtle transition hover:text-foreground"
          >
            Tout le journal →
          </Link>
        </div>
        {recent.data && recent.data.length > 0 ? (
          <ul className="mt-2 border-t border-border">
            {recent.data.map((r) => (
              <li
                key={r.id as string}
                className="flex items-baseline gap-4 border-b border-border py-2"
              >
                <span className="batta-tabular w-24 shrink-0 text-[11.5px] text-subtle">
                  {relative(r.created_at as string)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                  {actionLabel(r.action as string)}
                </span>
                <span className="hidden shrink-0 text-[11.5px] text-subtle sm:block">
                  {(r.user_email as string | null) ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 border-t border-border pt-3 text-[12.5px] text-subtle">
            Aucune action enregistrée pour le moment.
          </p>
        )}
      </section>
    </AdminPage>
  );
}

function Figure({
  label,
  value,
  accent = false,
  danger = false,
  className = "",
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
  className?: string;
}) {
  return (
    <div className={`py-4 ps-4 first:ps-0 ${className}`}>
      <div className={EYEBROW}>{label}</div>
      <div
        className={`batta-tabular mt-1.5 text-[30px] font-semibold leading-none ${
          danger ? "text-[var(--tone-bad)]" : accent ? "text-[var(--gold)]" : "text-foreground"
        }`}
      >
        {value.toLocaleString("fr-FR")}
      </div>
    </div>
  );
}

/** "il y a 4 min" / "il y a 3 h" / "il y a 2 j" — short enough for a column. */
function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
