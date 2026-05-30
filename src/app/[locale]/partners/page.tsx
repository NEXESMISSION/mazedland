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
              For institutions
            </span>
            <h1
              className={`mt-3 text-[28px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              <span className="gradient-gold-text">{t("nav.forBanks")}</span>
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
              Liquidate distressed assets at 10–20 % higher prices through
              transparent auctions attended by KYC-verified bidders worldwide.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-7 px-4">
        <span className="batta-eyebrow">Partner programmes</span>
        <h2
          className={`mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight ${
            isRTL ? "font-arabic" : ""
          }`}
        >
          Three ways to work with Batta
        </h2>

        <div className="mt-4 grid gap-3 lg:grid-cols-3 lg:gap-5">
          <PartnerCard
            Icon={Landmark}
            kicker="Banks"
            title="Distressed-asset liquidation"
            body="Dedicated dashboard, bulk listing, monthly P&amp;L reporting, API into your loan-tracking system."
            cta="Talk to us"
            ctaHref="/partners/contact?segment=bank"
            isRTL={isRTL}
            perks={[
              "Preferential 2% commission",
              "Dedicated account manager",
              "Auction calendar planning",
              "Legal closing pipeline",
            ]}
          />
          <PartnerCard
            Icon={Building2}
            kicker="Agencies"
            title="Real-estate agencies"
            body="Three subscription tiers from 99 to 799 TND/month. Verified-agency badge. Featured listings each month."
            cta="See plans"
            ctaHref="/contact?segment=agency"
            isRTL={isRTL}
            perks={[
              "Up to unlimited listings",
              "Verified-agency badge",
              "Featured slots monthly",
              "Up to 1% commission discount",
            ]}
          />
          <PartnerCard
            Icon={Briefcase}
            kicker="Huissiers"
            title="Court bailiffs"
            body="Digitise judicial auctions. Reach 3–5 × more bidders than newspaper notices, while staying inside the legal framework."
            cta="Apply for accreditation"
            ctaHref="/contact?segment=bailiff"
            isRTL={isRTL}
            perks={[
              "Free first three auctions",
              "Auto-formatted notices",
              "Built-in 8-day +1/6 window",
              "Sealed digital minutes",
            ]}
          />
        </div>

        {/* Comparison strip */}
        <div className="batta-frame-gold relative mt-6 p-6">
          <div className="relative">
            <span className="batta-eyebrow">Versus the legacy channel</span>
            <h3
              className={`mt-1.5 text-[18px] font-bold text-foreground ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              Why Batta beats newspaper notices
            </h3>
            <div className="mt-4 grid grid-cols-3 divide-x divide-border">
              <CompareStat label="Sale uplift" value="+12%" />
              <CompareStat label="Time to hammer" value="14d" />
              <CompareStat label="Verified bidders" value="100%" />
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
