import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { Mail, Phone, MapPin, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact — Mazed Immo",
};

// Pure static content — prerender at build and serve from the edge CDN.
export const dynamic = "force-static";

/**
 * The e-mail row is env-driven and DISAPPEARS when unset.
 *
 * It used to be a literal, contact@batta.tn, on a domain the business owned.
 * The rebrand has no domain behind it yet, and the honest options were an
 * address that bounces or no address at all — a support page whose first line
 * is a dead mailbox is worse than one that only offers a phone number. Set
 * NEXT_PUBLIC_CONTACT_EMAIL and the row comes back.
 */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();

const ITEMS = [
  ...(CONTACT_EMAIL
    ? [{ Icon: Mail, label: "E-mail", value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` }]
    : []),
  { Icon: Phone, label: "Téléphone", value: "+216 70 000 000", href: "tel:+21670000000" },
  { Icon: MapPin, label: "Adresse", value: "Sfax, Tunisie", href: null },
  { Icon: Clock, label: "Horaires", value: "Lun – Ven, 9h – 17h", href: null },
];

export default function ContactPage() {
  return (
    <LegalPage eyebrow="Aide" title="Contactez-nous">
      <p className="text-[13.5px] leading-relaxed text-foreground/80">
        Une question sur une annonce, un paiement ou votre compte ? Notre équipe
        est là pour vous aider.
      </p>
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
