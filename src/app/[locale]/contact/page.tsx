import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { Mail, Phone, MapPin, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact — Batta.tn",
};

const ITEMS = [
  { Icon: Mail, label: "E-mail", value: "contact@batta.tn", href: "mailto:contact@batta.tn" },
  { Icon: Phone, label: "Téléphone", value: "+216 70 000 000", href: "tel:+21670000000" },
  { Icon: MapPin, label: "Adresse", value: "Sfax, Tunisie", href: null },
  { Icon: Clock, label: "Horaires", value: "Lun – Ven, 9h – 17h", href: null },
];

export default function ContactPage() {
  return (
    <LegalPage eyebrow="Aide" title="Contactez-nous">
      <p className="text-[13.5px] leading-relaxed text-foreground/80">
        Une question sur une enchère, un paiement ou votre compte ? Notre équipe
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
