import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Landmark, Building2, Briefcase, Check, ArrowUpRight } from "lucide-react";

/**
 * Institutional landing — banks, agencies, court bailiffs. Dark hero
 * with the prospectus pitch, three partner cards on the surface
 * background, closing comparison strip.
 */
export default async function PartnersLanding() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  return (
    <div className="mx-auto max-w-[var(--max-w)] lg:max-w-[var(--max-w-wide)]">
      <section className="px-4 pt-4">
        <div className="batta-surface-navy-luxe relative overflow-hidden rounded-2xl ring-1 ring-gold/25">
          <div className="relative p-6">
            <span className="batta-eyebrow inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-gold pulse-gold" />
              Pour les institutions
            </span>
            <h1
              className={`mt-3 text-[28px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              <span className="gradient-gold-text">{t("nav.forBanks")}</span>
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
              Liquidez vos actifs 10–20% plus cher, via des enchères vérifiées.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-7 px-4">
        <span className="batta-eyebrow">Programmes partenaires</span>
        <h2
          className={`mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight ${
            isRTL ? "font-arabic" : ""
          }`}
        >
          Trois façons de travailler avec Batta
        </h2>

        <div className="mt-4 grid gap-3 lg:grid-cols-3 lg:gap-5">
          <PartnerCard
            Icon={Landmark}
            kicker="Banques"
            title="Liquidation d'actifs"
            body="Tableau de bord dédié, mise en ligne groupée, reporting mensuel, API."
            cta="Nous contacter"
            ctaHref="/partners/contact?segment=bank"
            isRTL={isRTL}
            perks={[
              "Commission préférentielle 2%",
              "Gestionnaire dédié",
              "Calendrier d'enchères",
              "Clôture juridique",
            ]}
          />
          <PartnerCard
            Icon={Building2}
            kicker="Agences"
            title="Agences immobilières"
            body="Abonnements de 99 à 799 TND/mois. Badge agence vérifiée. Annonces mises en avant."
            cta="Voir les offres"
            ctaHref="/contact?segment=agency"
            isRTL={isRTL}
            perks={[
              "Annonces illimitées",
              "Badge agence vérifiée",
              "Mises en avant mensuelles",
              "Jusqu'à 1% de remise",
            ]}
          />
          <PartnerCard
            Icon={Briefcase}
            kicker="Huissiers"
            title="Huissiers de justice"
            body="Digitalisez les ventes judiciaires. 3 à 5× plus d'enchérisseurs, dans le cadre légal."
            cta="Demander l'accréditation"
            ctaHref="/contact?segment=bailiff"
            isRTL={isRTL}
            perks={[
              "3 premières enchères offertes",
              "Avis auto-formatés",
              "Fenêtre +1/6 sur 8 jours",
              "Procès-verbaux numériques",
            ]}
          />
        </div>

        {/* Comparison strip */}
        <div className="batta-frame-gold relative mt-6 p-6">
          <div className="relative">
            <span className="batta-eyebrow">Face au canal classique</span>
            <h3
              className={`mt-1.5 text-[18px] font-bold text-foreground ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              Pourquoi Batta surpasse les annonces papier
            </h3>
            <div className="mt-4 grid grid-cols-3 divide-x divide-border">
              <CompareStat label="Gain de prix" value="+12%" />
              <CompareStat label="Délai de vente" value="14j" />
              <CompareStat label="Acheteurs vérifiés" value="100%" />
            </div>
          </div>
        </div>

        <div aria-hidden className="h-6" />
      </section>
    </div>
  );
}

function PartnerCard({
  Icon, kicker, title, body, cta, ctaHref, perks, isRTL,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  kicker: string;
  title: string;
  body: string;
  cta: string;
  ctaHref: string;
  perks: string[];
  isRTL: boolean;
}) {
  return (
    <div className="relative flex flex-col rounded-2xl bg-surface p-5 ring-1 ring-border transition-all hover:ring-gold-soft/40">
      <div className="flex items-start justify-between gap-3">
        <span className="batta-monogram size-11 shrink-0 text-[16px] font-extrabold">
          <Icon className="size-[18px]" strokeWidth={2.2} />
        </span>
        <span className="batta-pill-gold">
          {kicker}
        </span>
      </div>
      <h3
        className={`mt-4 text-[20px] font-extrabold leading-tight text-foreground ${
          isRTL ? "font-arabic" : ""
        }`}
      >
        {title}
      </h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {body}
      </p>
      <div aria-hidden className="batta-hairline mt-4" />
      <ul className="mt-3 flex-1 space-y-1.5 text-[12.5px] text-foreground/85">
        {perks.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-gold" strokeWidth={2.5} />
            {p}
          </li>
        ))}
      </ul>
      <Link
        href={ctaHref as `/${string}`}
        className="batta-btn-luxe tap-target mt-5 w-full px-5 py-2.5 text-[12.5px]"
      >
        {cta}
        <ArrowUpRight className="size-4" strokeWidth={2} />
      </Link>
    </div>
  );
}

function CompareStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-1 text-center">
      <div className="batta-tabular gradient-gold-text text-[22px] font-extrabold leading-none">
        {value}
      </div>
      <div className="mt-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
    </div>
  );
}
