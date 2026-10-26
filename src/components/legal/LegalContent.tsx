import { useTranslations } from "next-intl";

/**
 * Shared legal copy — rendered on the standalone /terms and /privacy pages AND
 * inside the signup modal, so there is a single source of truth. Plain
 * presentational components usable from server or client: next-intl's
 * useTranslations works in both, so the same component renders on the static
 * legal pages and inside the client-side signup form.
 *
 * WHAT CHANGED. These described an auction house: KYC before bidding, bids as
 * firm commitments, cautions that could be forfeited, identity documents held
 * for verification. None of that exists. Terms that describe a service the
 * user is not getting are not merely stale — they are the document a dispute
 * would be settled against. They now describe the classifieds service as it
 * actually runs.
 *
 * The text lives in messages (`legal.terms.sections`, `legal.privacy.sections`),
 * one { title, body } per section, in the order listed below. The Arabic is a
 * faithful translation into plain Modern Standard Arabic.
 *
 * General informational copy, not a substitute for legal review before launch.
 */

const TERMS_SECTIONS = [
  "purpose",
  "account",
  "listings",
  "fees",
  "matching",
  "liability",
  "suspension",
  "changes",
] as const;

const PRIVACY_SECTIONS = [
  "collected",
  "use",
  "phone",
  "sharing",
  "retention",
  "rights",
  "cookies",
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
      <div className="mt-1.5 space-y-2 text-[13.5px] leading-relaxed text-foreground/80">
        {children}
      </div>
    </section>
  );
}

export function TermsContent() {
  const t = useTranslations("legal.terms.sections");
  return (
    <div>
      {TERMS_SECTIONS.map((key) => (
        <Section key={key} title={t(`${key}.title`)}>
          <p>{t(`${key}.body`)}</p>
        </Section>
      ))}
    </div>
  );
}

export function PrivacyContent() {
  const t = useTranslations("legal.privacy.sections");
  return (
    <div>
      {PRIVACY_SECTIONS.map((key) => (
        <Section key={key} title={t(`${key}.title`)}>
          <p>{t(`${key}.body`)}</p>
        </Section>
      ))}
    </div>
  );
}
