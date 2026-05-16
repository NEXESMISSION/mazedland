import { redirect, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { formatTND } from "@/lib/utils";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { Trophy, Hourglass, ScrollText } from "lucide-react";

/**
 * Auctions where the active user is the recorded winner. Three states
 * (sixth_offer_window / awarded / ended_sold) get distinct tones +
 * next-step copy so the winner knows what to do next.
 */
export default async function MyWinsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations();
  const dateLocale = await getLocale();
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data: rows } = await supabase
    .from("auctions")
    .select(`
      id, status, winner_amount, hammer_at, sixth_offer_deadline,
      property:properties (
        title, governorate, type,
        photos:property_photos (id, storage_path, sort_order)
      )
    `)
    .eq("winner_user_id", user!.id)
    .in("status", ["sixth_offer_window", "awarded", "ended_sold"])
    .order("hammer_at", { ascending: false })
    .limit(50);

  const wins = (rows ?? []) as unknown as Array<{
    id: string;
    status: string;
    winner_amount: number | null;
    hammer_at: string | null;
    sixth_offer_deadline: string | null;
    property: {
      title: string;
      governorate: string;
      type: string;
      photos: { id: string; storage_path: string; sort_order: number }[];
    };
  }>;

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
      <span className="batta-eyebrow">Hammers won</span>
      <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        {t("wins.title")}
      </h1>

      {wins.length === 0 ? (
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <Trophy className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">{t("wins.empty")}</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3 pb-6">
          {wins.map((w) => {
            const photo = w.property.photos?.sort((a, b) => a.sort_order - b.sort_order)[0];
            const statusLabel =
              w.status === "sixth_offer_window" ? t("wins.sixthOfferStatus") :
              w.status === "awarded" ? t("wins.awardedStatus") :
              t("wins.soldStatus");
            const StatusIcon =
              w.status === "sixth_offer_window" ? Hourglass :
              w.status === "awarded" ? ScrollText :
              Trophy;
            const tone =
              w.status === "sixth_offer_window" ? "batta-tone-warn" :
              w.status === "awarded" ? "bg-gold-faint text-gold-bright border-y border-gold/30" :
              "batta-tone-ok";

            return (
              <li
                key={w.id}
                className="overflow-hidden rounded-xl bg-surface ring-1 ring-border transition-all hover:ring-gold-soft/40"
              >
                <div className="flex gap-3 p-3">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                    {photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={propertyPhotoUrl(photo.storage_path)}
                        alt={w.property.title}
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-foreground">{w.property.title}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">
                      {w.property.governorate} · {w.property.type}
                    </div>
                    <div className="batta-tabular gradient-gold-text mt-1.5 text-[18px] font-extrabold leading-none">
                      {formatTND(Number(w.winner_amount ?? 0), dateLocale)}{" "}
                      <span className="text-[10px] font-bold text-muted">{t("common.tnd")}</span>
                    </div>
                    {w.hammer_at && (
                      <div className="mt-0.5 text-[10px] text-muted">
                        {t("wins.wonAt", { date: new Date(w.hammer_at).toLocaleDateString(dateLocale) })}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`flex items-center gap-2 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.14em] ${tone}`}>
                  <StatusIcon className="size-3.5" strokeWidth={2.2} />
                  <span className="flex-1">{statusLabel}</span>
                  {w.status === "sixth_offer_window" && w.sixth_offer_deadline && (
                    <span className="text-[10px] normal-case tracking-normal opacity-80">
                      {t("wins.endsOn", {
                        date: new Date(w.sixth_offer_deadline).toLocaleDateString(dateLocale),
                      })}
                    </span>
                  )}
                </div>

                {w.status === "awarded" && (
                  <div className="border-t border-border bg-surface-2 px-3 py-2.5 text-[11px] text-muted">
                    <div className="font-extrabold uppercase tracking-[0.14em] text-foreground">
                      {t("wins.nextSteps")}
                    </div>
                    <div className="mt-0.5">{t("wins.nextStepsBody")}</div>
                  </div>
                )}

                <Link
                  href={`/auctions/${w.id}` as `/auctions/${string}`}
                  className="tap-target flex w-full items-center justify-center gap-1 border-t border-border py-2.5 text-[12px] font-bold text-gold-bright hover:bg-surface-2"
                >
                  {t("wins.viewAuction")}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
