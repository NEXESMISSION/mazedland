import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { loadVisits } from "@/lib/visits-server";
import { VisitCard } from "@/components/visits/VisitCard";

export const dynamic = "force-dynamic";

/**
 * Mes visites (0174): the requests others sent about my annonces, and the
 * ones I sent. A shop's team also sees its annonces' visits in the Espace Pro.
 */
export default async function MyVisitsPage({ searchParams }: { searchParams: Promise<{ tab?: string; v?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("visits.page");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/visites`)}`);
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const [received, sent] = await Promise.all([loadVisits(admin, { seller: user!.id }), loadVisits(admin, { buyer: user!.id })]);
  // Without a tab: where the visit named in the link is, else where something waits, else what I sent.
  const tab =
    sp.tab === "sent" || sp.tab === "received"
      ? sp.tab
      : sp.v && sent.some((v) => v.id === sp.v)
        ? "sent"
        : received.length > 0
          ? "received"
          : "sent";
  const list = tab === "received" ? received : sent;
  const waiting = received.filter((v) => v.status === "requested").length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
      <h1 className="text-[24px] font-extrabold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>

      <nav className="mt-5 flex gap-1.5">
        {(["received", "sent"] as const).map((k) => (
          <Link
            key={k}
            href={`/account/visites?tab=${k}` as never}
            aria-current={tab === k ? "page" : undefined}
            className={`tap-target inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-bold ${
              tab === k ? "border-gold-soft bg-gold-faint text-foreground" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t(`tabs.${k}`)}
            {k === "received" && waiting > 0 && <span className="mazed-tabular text-[11px] text-[var(--tone-warn)]">{waiting}</span>}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-[13px] leading-relaxed text-muted">
          {t(tab === "received" ? "emptyReceived" : "emptySent")}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {list.map((v) => (
            <VisitCard key={v.id} visit={v} side={tab === "received" ? "seller" : "buyer"} locale={locale} highlight={v.id === sp.v} />
          ))}
        </div>
      )}
    </main>
  );
}
