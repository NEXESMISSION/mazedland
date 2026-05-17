"use client";

import { useState } from "react";
import Image from "next/image";
import {
  CreditCard,
  Smartphone,
  Wallet,
  Building2,
  Lock,
  ArrowRight,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatTND } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  kind: "deposit" | "buy_now" | "final_payment";
  kindLabel: string;
  kindBody: string;
  amount: number;
  auction: {
    id: string;
    title: string;
    governorate: string;
    heroPhotoPath: string | null;
  };
  locale: string;
}

type Provider = "konnect" | "paymee" | "flouci" | "d17" | "manual";

const PROVIDERS: Array<{
  value: Provider;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  {
    value: "konnect",
    label: "Konnect",
    description: "Carte bancaire (Visa / Mastercard / Edinar) · wallet",
    Icon: CreditCard,
  },
  {
    value: "paymee",
    label: "Paymee",
    description: "Carte bancaire tunisienne",
    Icon: CreditCard,
  },
  {
    value: "flouci",
    label: "Flouci",
    description: "Wallet Flouci",
    Icon: Wallet,
  },
  {
    value: "d17",
    label: "D17 · La Poste",
    description: "Mobile money D17 — Poste Tunisienne",
    Icon: Smartphone,
  },
  {
    value: "manual",
    label: "Virement bancaire",
    description: "Vérification admin · 24 à 48 h",
    Icon: Building2,
  },
];

/**
 * Checkout page client. Renders a provider chooser + auction summary +
 * submit CTA. On submit, POSTs to the type-specific endpoint which
 * returns a `hostedUrl` (mock or real gateway) we redirect to.
 *
 * The auction context + amount are server-rendered so the user can't
 * forge a lower price by editing the URL.
 */
export function CheckoutClient({
  kind,
  kindLabel,
  kindBody,
  amount,
  auction,
  locale,
}: Props) {
  const { toast } = useToast();
  const [provider, setProvider] = useState<Provider>("konnect");
  const [submitting, setSubmitting] = useState(false);

  // Map the checkout kind to the type-specific endpoint that creates
  // the payment row + returns the gateway hostedUrl.
  const endpoint = (() => {
    switch (kind) {
      case "deposit":
        return `/api/auctions/${auction.id}/deposit`;
      case "buy_now":
        return `/api/auctions/${auction.id}/buy-now`;
      case "final_payment":
        return `/api/auctions/${auction.id}/final-payment`;
    }
  })();

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.detail ?? data.error ?? "Erreur de paiement.", "error");
        setSubmitting(false);
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        hostedUrl?: string;
        alreadyLocked?: boolean;
        alreadyPurchased?: boolean;
      };
      // Server-side state already matches a captured payment — skip the
      // gateway and bounce straight to success so the user sees
      // confirmation rather than wondering what happened.
      if (data.alreadyLocked || data.alreadyPurchased) {
        window.location.href = `/auctions/${auction.id}`;
        return;
      }
      if (data.hostedUrl) {
        window.location.href = data.hostedUrl;
        return;
      }
      toast("Réponse inattendue du serveur de paiement.", "error");
      setSubmitting(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erreur réseau.", "error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Back navigation lives in the global TopBar (parent-path mapping
          sends /payment/checkout back to /). No page-specific back
          button here, so the layout reads as one continuous flow. */}
      <main className="max-w-2xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-5">
        {/* Auction summary card */}
        <section className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
          <div className="flex gap-3 p-3">
            <div className="relative h-20 w-20 shrink-0 rounded-xl overflow-hidden bg-[var(--surface-2)]">
              {auction.heroPhotoPath ? (
                <Image
                  src={propertyPhotoUrl(auction.heroPhotoPath)}
                  alt={auction.title}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-2xl text-foreground/15">
                  🏛️
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--gold)]">
                {kindLabel}
              </div>
              <h1 className="mt-0.5 text-[15px] font-bold leading-tight line-clamp-2">
                {auction.title}
              </h1>
              <div className="mt-1 text-[11px] text-[var(--foreground-muted)]">
                {auction.governorate}
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--border)] bg-[var(--surface-2)]/40 px-4 py-3 flex items-baseline justify-between gap-3">
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)]">
              Montant à payer
            </span>
            <span className="batta-tabular gradient-gold-text text-2xl font-extrabold">
              {formatTND(amount, locale)}{" "}
              <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--gold)]/80">
                TND
              </span>
            </span>
          </div>
          <p className="px-4 pb-3 pt-2 text-[11px] text-[var(--foreground-muted)] leading-relaxed">
            {kindBody}
          </p>
        </section>

        {/* Provider chooser */}
        <section>
          <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)] mb-2 inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3 text-[var(--gold)]" />
            Mode de paiement
          </div>
          <div className="space-y-2">
            {PROVIDERS.map((p) => {
              const active = provider === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProvider(p.value)}
                  className={cn(
                    "w-full text-start rounded-xl border p-3.5 transition-colors flex items-center gap-3",
                    active
                      ? "border-[var(--gold)] bg-[var(--gold-faint)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--gold-soft)]",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      active
                        ? "bg-[var(--gold)] text-black"
                        : "bg-[var(--surface-2)] text-[var(--foreground-muted)]",
                    )}
                  >
                    <p.Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">{p.label}</div>
                    <div className="text-[11px] text-[var(--foreground-muted)] mt-0.5">
                      {p.description}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "h-4 w-4 shrink-0 rounded-full border-2 transition-colors",
                      active
                        ? "border-[var(--gold)] bg-[var(--gold)]"
                        : "border-[var(--border)]",
                    )}
                  >
                    {active && (
                      <span className="block h-full w-full rounded-full bg-black/40 scale-[0.4]" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Trust strip */}
        <section className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[var(--foreground-muted)] leading-snug">
          <span className="inline-flex items-start gap-1.5">
            <Lock className="h-3 w-3 text-[var(--gold)] mt-0.5 shrink-0" />
            Paiement chiffré · conforme aux normes bancaires tunisiennes.
          </span>
          <span className="inline-flex items-start gap-1.5">
            <ShieldCheck className="h-3 w-3 text-[var(--gold)] mt-0.5 shrink-0" />
            Aucun débit n&apos;est effectué sans votre confirmation.
          </span>
        </section>

        {/* Sticky submit */}
        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/95 backdrop-blur-xl border-t border-[var(--border)] pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:static lg:mx-0 lg:px-0 lg:py-0 lg:bg-transparent lg:backdrop-blur-none lg:border-0">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full h-13 lg:h-14 rounded-[var(--radius)] bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] text-black font-bold text-[14px] shadow-[var(--shadow-gold)] active:scale-[0.99] transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {submitting
              ? "Connexion à la passerelle…"
              : `Payer ${formatTND(amount, locale)} TND`}
          </button>
        </div>
      </main>
    </div>
  );
}
