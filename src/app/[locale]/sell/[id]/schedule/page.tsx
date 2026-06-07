import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ScheduleForm } from "@/components/sell/ScheduleForm";
import { parseAntiSnipe } from "@/lib/pricing";
import { Clock } from "lucide-react";

// Per-user, auth-gated — never static (env-less prerender would throw + fail the build).
export const dynamic = "force-dynamic";

// Schedule an auction for an already-approved listing.
export default async function ScheduleAuctionPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const t = await getTranslations();
  const currentLocale = await getLocale();
  const isRTL = currentLocale === "ar";
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const { data: property } = await supabase
    .from("properties")
    .select("id, title, status, owner_id, governorate, type")
    .eq("id", id)
    .single();

  if (!property || property.owner_id !== user!.id) {
    redirect({ href: "/sell", locale });
  }

  // Not-ready guard. Renders an info card instead of the form so the
  // seller knows they have to wait for admin approval.
  if (property!.status !== "ready") {
    return (
      <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
        <header>
          <span className="batta-eyebrow">En attente de validation</span>
          <h1
            className={`mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {property!.title}
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted">
            {property!.governorate} · {property!.type}
          </p>
        </header>
        <div className="batta-tone-warn mt-6 flex items-start gap-3 rounded-xl p-5 text-[13px]">
          <Clock className="size-5 shrink-0" strokeWidth={2.2} />
          <span>{t("schedule.notReady")}</span>
        </div>
        <Link
          href="/sell"
          className="batta-btn-luxe tap-target mt-5 inline-flex w-full px-5 py-3 text-[13.5px]"
        >
          {t("common.back")}
        </Link>
      </div>
    );
  }

  // Admin-controlled anti-snipe defaults — baked onto the new auction so
  // the platform-wide setting governs it (see /admin/settings).
  const { data: snipeRow } = await supabase
    .from("app_settings").select("value").eq("key", "auction_antisnipe").maybeSingle();
  const antiSnipe = parseAntiSnipe(snipeRow?.value);

  const { data: existing } = await supabase
    .from("auctions")
    .select("id, status")
    .eq("property_id", property!.id)
    .not("status", "in", "(cancelled,ended_unsold)")
    .maybeSingle();

  if (existing) {
    return (
      <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
        <header>
          <span className="batta-eyebrow">Déjà en ligne</span>
          <h1
            className={`mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            {property!.title}
          </h1>
        </header>
        <div className="batta-frame-gold relative mt-6 p-5 text-[13px] text-foreground/85">
          <div className="relative">
            <p>
              {t("schedule.alreadyHasAuction")}{" "}
              <Link
                href={`/auctions/${existing.id}` as `/auctions/${string}`}
                className="font-extrabold text-gold-bright underline"
              >
                {t("schedule.viewIt")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
      <header>
        <span className="batta-eyebrow">Mise en vente · enchère</span>
        <h1
          className={`mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight ${
            isRTL ? "font-arabic" : ""
          }`}
        >
          {t("schedule.title")}
        </h1>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted">{property!.title}</p>
        <p className="mt-2 text-[12.5px] text-muted">{t("schedule.subtitle")}</p>
      </header>
      <div className="mt-5">
        <ScheduleForm
          propertyId={property!.id}
          extendWindowSec={antiSnipe.windowMin * 60}
          extendBySec={antiSnipe.extendMin * 60}
        />
      </div>
    </div>
  );
}
