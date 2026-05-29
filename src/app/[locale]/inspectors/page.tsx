import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { ClipboardCheck, MapPin, Star, ArrowUpRight } from "lucide-react";

/**
 * Inspector roster — the flagship moat. Dark hero with the pitch, a
 * monogrammed 2-up roster grid, and a closing apply CTA.
 */
export default async function InspectorsIndex() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  let inspectors: unknown[] | null = null;
  try {
    const supabase = await getServerSupabase();
    const { data } = await supabase
      .from("inspectors")
      .select(`
        id, speciality, governorates, bio, rating_avg, rating_count,
        profile:profiles!inner (full_name)
      `)
      .eq("approved", true)
      .order("rating_avg", { ascending: false })
      .limit(48);
    inspectors = data;
  } catch (err) {
    console.warn("[/inspectors] supabase unavailable:", err instanceof Error ? err.message : err);
  }

  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      {/* HERO */}
      <section className="px-4 pt-4">
        <div className="batta-surface-navy-luxe relative overflow-hidden rounded-2xl ring-1 ring-gold/25">
          <div className="relative p-6">
            <span className="batta-eyebrow inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-gold pulse-gold" />
              Agréés · 24 gouvernorats
            </span>
            <h1
              className={`mt-3 text-[28px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              <span className="gradient-gold-text">{t("landing.inspectorTitle")}</span>
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
              {t("landing.inspectorBody")}
            </p>
            <Link
              href="/inspectors/apply"
              className="batta-btn-luxe tap-target mt-5 w-full px-5 py-3 text-[13.5px]"
            >
              <ClipboardCheck className="size-4" strokeWidth={2} />
              {t("landing.inspectorCta")}
            </Link>
          </div>
        </div>
      </section>

      {/* ROSTER */}
      <section className="mt-7 px-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="batta-eyebrow">Le réseau</span>
            <h2
              className={`mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              Inspecteurs agréés
            </h2>
          </div>
          {inspectors && inspectors.length > 0 && (
            <span className="batta-pill-gold mb-1">
              {inspectors.length} actifs
            </span>
          )}
        </div>

        {!inspectors || inspectors.length === 0 ? (
          <div className="batta-frame-gold relative mt-4 px-6 py-10 text-center">
            <span className="batta-monogram batta-monogram-filled mx-auto mb-3 size-12 text-[20px]">
              ✦
            </span>
            <p className="text-[17px] font-bold text-foreground">
              Première promotion en cours d&apos;intégration
            </p>
            <p className="mt-2 text-[12px] text-muted">
              Tunis, Sousse, Sfax — les premiers gouvernorats bientôt en ligne.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 pb-6 lg:grid-cols-3 lg:gap-5">
            {(inspectors as Array<{
              id: string;
              speciality: string;
              governorates: string[] | null;
              bio: string | null;
              rating_avg: number | null;
              rating_count: number | null;
            }>).map((i) => {
              const profile = (i as unknown as { profile: { full_name: string | null } }).profile;
              const initials = (profile.full_name ?? "?")
                .split(" ")
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase();
              return (
                <div
                  key={i.id}
                  className="rounded-xl bg-surface p-3.5 ring-1 ring-border transition-all hover:ring-gold-soft/40"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="batta-monogram size-10 shrink-0 not-italic text-[14px] font-extrabold">
                      {initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[15px] font-bold leading-tight text-foreground ${
                          isRTL ? "font-arabic" : ""
                        }`}
                      >
                        {profile.full_name ?? "Inspecteur"}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.14em] text-muted">
                        {(i.speciality as string).replace(/_/g, " ")}
                      </div>
                    </div>
                  </div>

                  {(i.rating_avg ?? 0) > 0 && (
                    <div className="batta-tabular mt-2.5 inline-flex items-center gap-1 rounded-full bg-gold-faint px-2 py-0.5 text-[10px] font-extrabold text-gold-bright ring-1 ring-gold/30">
                      <Star className="size-2.5 fill-current" />
                      {Number(i.rating_avg).toFixed(1)}
                      <span className="font-medium text-gold/70">
                        · {i.rating_count ?? 0}
                      </span>
                    </div>
                  )}

                  <div aria-hidden className="batta-hairline mt-3" />

                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {((i.governorates as string[]) ?? []).slice(0, 3).map((g) => (
                      <span
                        key={g}
                        className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-muted"
                      >
                        <MapPin className="size-2.5" strokeWidth={2} />
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Closing CTA */}
      <section className="mt-4 px-4 pb-6">
        <Link
          href="/inspectors/apply"
          className="batta-frame tap-target flex items-center justify-between gap-3 p-5 transition active:scale-[0.99] hover:ring-gold-soft/40"
        >
          <div className="min-w-0">
            <span className="batta-eyebrow">Candidature</span>
            <div className={`mt-1 text-[18px] font-bold leading-tight text-foreground ${isRTL ? "font-arabic" : ""}`}>
              Rejoignez le réseau d&apos;inspecteurs
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted">
              8 nouvelles accréditations par trimestre.
            </div>
          </div>
          <span className="batta-gold-fill inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10 shadow-[var(--shadow-gold)]">
            <ArrowUpRight className="size-5" strokeWidth={2.5} />
          </span>
        </Link>
      </section>
    </div>
  );
}
