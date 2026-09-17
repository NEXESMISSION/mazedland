import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { Mail, Phone, MapPin, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact — Mazed Immo",
};

// Pure static content — prerender at build and serve from the edge CDN.
export const dynamic = "force-static";

/**
 * Both reachable channels are env-driven and DISAPPEAR when unset.
 *
 * The e-mail used to be a literal, contact@batta.tn, on a domain the business
 * owned; the rebrand has no domain behind it yet, and an address that bounces
 * is worse than no address. The phone was a literal too — "+216 70 000 000",
 * which is not a number anyone answers. It sat on the page as the ONLY
 * actionable detail, presented exactly like a real one: a visitor with a
 * question about a payment dialled it and got nothing.
 *
 * Set NEXT_PUBLIC_CONTACT_EMAIL / NEXT_PUBLIC_CONTACT_PHONE and the rows come
 * back. Until one of them is set the page says so, which is honest and is also
 * hard to miss.
 */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
const CONTACT_PHONE = process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim();

/** tel: wants digits and a leading +, not the spaces that make it readable. */
const telHref = (v: string) => `tel:${v.replace(/[^\d+]/g, "")}`;

const ITEMS = [
  ...(CONTACT_EMAIL
    ? [{ Icon: Mail, label: "E-mail", value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` }]
    : []),
  ...(CONTACT_PHONE
    ? [{ Icon: Phone, label: "Téléphone", value: CONTACT_PHONE, href: telHref(CONTACT_PHONE) }]
    : []),
  { Icon: MapPin, label: "Adresse", value: "Sfax, Tunisie", href: null },
  { Icon: Clock, label: "Horaires", value: "Lun – Ven, 9h – 17h", href: null },
];

const HAS_CHANNEL = Boolean(CONTACT_EMAIL || CONTACT_PHONE);

export default function ContactPage() {
  return (
    <LegalPage eyebrow="Aide" title="Contactez-nous">
      <p className="text-[13.5px] leading-relaxed text-foreground/80">
        Une question sur une annonce, un paiement ou votre compte ? Notre équipe
        est là pour vous aider.
      </p>
      {!HAS_CHANNEL && (
        <p className="mt-3 rounded-xl bg-surface-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-muted ring-1 ring-border">
          Nos coordonnées téléphonique et e-mail sont en cours de publication.
          En attendant, chaque décision sur vos annonces et vos paiements vous
          est notifiée dans l&apos;application et par SMS.
        </p>
      )}
      <ul className="mt-5 space-y-2.5">
        {ITEMS.map((it) => {
          const inner = (
            <>
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/30">
                <it.Icon className="size-4.5" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted">
                  {it.label}
                </div>
                <div className="mt-0.5 text-[14px] font-bold text-foreground">{it.value}</div>
              </div>
            </>
          );
          return (
            <li key={it.label}>
              {it.href ? (
                <a
                  href={it.href}
                  className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3.5 ring-1 ring-border transition hover:ring-gold-soft/60"
                >
                  {inner}
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3.5 ring-1 ring-border">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </LegalPage>
  );
}
