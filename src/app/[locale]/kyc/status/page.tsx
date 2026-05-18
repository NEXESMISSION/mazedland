"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { CheckCircle2, ShieldCheck, Clock, RefreshCw } from "lucide-react";
import { KYCShell } from "@/components/layout/KYCShell";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { getBrowserSupabase } from "@/lib/supabase/client";

export default function KYCStatusPage() {
  const { user, loaded } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  // Default to "submitted" while the user object is hydrating — the user
  // just submitted, so showing them the waiting screen is the right
  // optimistic guess.
  const status = loaded ? user?.kycStatus ?? "submitted" : "submitted";

  // Force-refresh the session on mount and periodically so an admin
  // approval lands without needing a sign-out + sign-in. The kyc_status
  // lives in `profiles`, which the auth hook re-reads on auth state
  // change — refreshing the session is the cheapest trigger.
  useEffect(() => {
    if (!loaded) return;
    if (status === "verified") return;
    const supabase = getBrowserSupabase();
    let cancelled = false;

    async function refresh() {
      if (cancelled) return;
      try {
        await supabase.auth.refreshSession();
      } catch {
        // ignore
      }
    }

    refresh();
    const id = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loaded, status]);

  async function manualRefresh() {
    setRefreshing(true);
    try {
      const supabase = getBrowserSupabase();
      await supabase.auth.refreshSession();
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  if (status === "rejected") {
    return (
      <KYCShell current={3}>
        <div className="space-y-6 py-8 text-center">
          <div className="mx-auto h-20 w-20 rounded-full bg-red-500/15 flex items-center justify-center">
            <span className="text-4xl">✗</span>
          </div>
          <div>
            <h2 className="text-xl font-bold">Vérification refusée</h2>
            <p className="text-sm text-[var(--foreground-muted)] mt-2 leading-relaxed">
              Vos documents n&apos;ont pas pu être validés. Reprenez la
              vérification ou contactez le support si vous pensez qu&apos;il
              s&apos;agit d&apos;une erreur.
            </p>
          </div>
          <div className="space-y-2">
            <Link href="/kyc/start">
              <Button size="lg" fullWidth>Recommencer la vérification</Button>
            </Link>
            <Link href="/contact">
              <Button size="lg" variant="ghost" fullWidth>Contacter le support</Button>
            </Link>
          </div>
        </div>
      </KYCShell>
    );
  }

  if (status === "verified") {
    // Role-aware CTA. Anyone verified can bid; some roles (agency, bank,
    // bailiff) also publish listings. Default to the buyer-style CTA
    // since every verified account can bid.
    const role = user?.role ?? "individual";
    const isPartner = role === "agency" || role === "bank" || role === "bailiff";
    return (
      <KYCShell current={3}>
        <div className="space-y-6 py-6 text-center">
          <div className="relative mx-auto h-24 w-24">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(74,222,128,0.4), transparent)",
              }}
            />
            <div className="relative h-full w-full rounded-full bg-green-500 flex items-center justify-center shadow-[0_0_50px_rgba(74,222,128,0.5)]">
              <CheckCircle2 className="h-12 w-12 text-white" strokeWidth={2.5} />
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-extrabold">Identité vérifiée</h2>
            <p className="text-sm text-[var(--foreground-muted)] mt-2 leading-relaxed">
              {isPartner
                ? "Vous pouvez maintenant publier vos biens et enchérir sur la plateforme."
                : "Vous pouvez maintenant enchérir sur Batta et finaliser légalement vos achats."}
            </p>
          </div>

          <div className="rounded-[var(--radius-md)] bg-[var(--gold-faint)] border border-[var(--gold-soft)]/40 p-4">
            <div className="flex items-center justify-center gap-2 text-[var(--gold)] font-bold mb-1">
              <ShieldCheck className="h-5 w-5" />
              Compte vérifié
            </div>
            <div className="text-xs text-[var(--foreground-muted)]">
              {isPartner
                ? "Votre badge partenaire est désormais visible sur vos annonces."
                : "Votre badge enchérisseur apparaît sur chaque enchère que vous placez."}
            </div>
          </div>

          <div className="space-y-2">
            {isPartner ? (
              <>
                <Link href="/sell">
                  <Button size="lg" fullWidth>Publier un bien</Button>
                </Link>
                <Link href="/properties">
                  <Button size="lg" variant="ghost" fullWidth>Voir les enchères</Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/properties">
                  <Button size="lg" fullWidth>Voir les enchères</Button>
                </Link>
                <Link href="/account">
                  <Button size="lg" variant="ghost" fullWidth>Mon compte</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </KYCShell>
    );
  }

  // submitted / pending — what every user sees right after submitting.
  return (
    <KYCShell current={3}>
      <div className="space-y-6 py-8 text-center">
        <div className="relative mx-auto h-28 w-28">
          {/* Soft outer halo for depth — same recipe as the favorites
              empty state, scaled to a single icon. */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(30,58,138,0.28), transparent 70%)",
            }}
          />
          {/* Gradient disc + slow conic spin ring → "review in progress"
              feels alive without spamming a hard spinner. */}
          <div className="relative h-full w-full rounded-full batta-gradient-gold shadow-[var(--shadow-gold)] flex items-center justify-center">
            <span className="absolute inset-[-6px] rounded-full border-2 border-[var(--gold-soft)]/40 border-t-[var(--gold)] animate-spin [animation-duration:2.4s]" />
            <Clock className="relative h-12 w-12 text-white" strokeWidth={2} />
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-extrabold">Vérification en cours</h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-2 leading-relaxed">
            Notre équipe va examiner votre dossier dans les prochaines heures.
            Vous recevrez un email dès la validation.
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] p-4 text-start space-y-3">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-[var(--gold)] shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-bold">Délai habituel : 24 à 48 h ouvrées</div>
              <div className="text-xs text-[var(--foreground-muted)] mt-0.5 leading-relaxed">
                Les soumissions reçues le week-end sont traitées le lundi matin.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-[var(--gold)] shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-bold">Accès limité en attendant</div>
              <div className="text-xs text-[var(--foreground-muted)] mt-0.5 leading-relaxed">
                Vous pouvez parcourir les enchères mais pas encore enchérir
                ni publier.
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            size="lg"
            fullWidth
            onClick={manualRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Actualisation…" : "Re-vérifier mon statut"}
          </Button>
          <Link href="/properties">
            <Button size="lg" variant="secondary" fullWidth>Parcourir les enchères</Button>
          </Link>
          <Link href="/">
            <Button size="lg" variant="ghost" fullWidth>Retour à l&apos;accueil</Button>
          </Link>
        </div>
      </div>
    </KYCShell>
  );
}
