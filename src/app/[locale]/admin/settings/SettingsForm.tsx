"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { Check, Loader2, Save } from "lucide-react";

export type SettingsValues = {
  listing_fee_tnd: number;
  promo_home_featured_tnd: number;
  promo_top_listed_tnd: number;
  promo_banner_tnd: number;
  payee_name: string;
  payee_bank: string;
  payee_rib: string;
  payee_iban: string;
  payee_d17: string;
};

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<SettingsValues>(initial);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function update<K extends keyof SettingsValues>(key: K, val: SettingsValues[K]) {
    setValues((v) => ({ ...v, [key]: val }));
    setSaved(false);
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.error ?? "Échec de l'enregistrement.", "error");
        return;
      }
      setSaved(true);
      toast("Réglages enregistrés.", "success");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSave} className="space-y-6">
      <Section title="Tarifs (TND)" hint="Définissent ce que le vendeur paie au moment de publier.">
        <NumField
          label="Frais de base par annonce"
          value={values.listing_fee_tnd}
          onChange={(v) => update("listing_fee_tnd", v)}
        />
        <NumField
          label="Option : Mise en avant (accueil)"
          value={values.promo_home_featured_tnd}
          onChange={(v) => update("promo_home_featured_tnd", v)}
        />
        <NumField
          label="Option : Top de la recherche"
          value={values.promo_top_listed_tnd}
          onChange={(v) => update("promo_top_listed_tnd", v)}
        />
        <NumField
          label="Option : Bannière d'accueil"
          value={values.promo_banner_tnd}
          onChange={(v) => update("promo_banner_tnd", v)}
        />
      </Section>

      <Section
        title="Coordonnées du bénéficiaire"
        hint="Affichées au vendeur sur la page de paiement (virement + D17)."
      >
        <TextField
          label="Bénéficiaire"
          value={values.payee_name}
          onChange={(v) => update("payee_name", v)}
        />
        <TextField
          label="Banque"
          value={values.payee_bank}
          onChange={(v) => update("payee_bank", v)}
        />
        <TextField
          label="RIB"
          mono
          value={values.payee_rib}
          onChange={(v) => update("payee_rib", v)}
        />
        <TextField
          label="IBAN"
          mono
          value={values.payee_iban}
          onChange={(v) => update("payee_iban", v)}
        />
        <TextField
          label="Numéro D17"
          mono
          value={values.payee_d17}
          onChange={(v) => update("payee_d17", v)}
        />
      </Section>

      <div className="sticky bottom-3 z-10">
        <button
          type="submit"
          disabled={isPending}
          className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : (
            <Save className="size-4" strokeWidth={2.5} />
          )}
          {isPending ? "Enregistrement…" : saved ? "Enregistré" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface p-4 ring-1 ring-border">
      <h3 className="text-[14px] font-bold text-foreground">{title}</h3>
      {hint && (
        <p className="mt-0.5 text-[11.5px] text-[var(--foreground-muted)]">{hint}</p>
      )}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">
        {label}
      </span>
      <div className="mt-1 flex items-stretch overflow-hidden rounded-xl border border-batta-gold/25 bg-batta-surface-2 focus-within:border-batta-gold focus-within:ring-1 focus-within:ring-batta-gold/40">
        <input
          type="number"
          step="0.01"
          min={0}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="batta-tabular flex-1 bg-transparent px-3 py-2.5 text-sm text-batta-cream focus:outline-none"
        />
        <span className="inline-flex items-center px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--foreground-muted)]">
          TND
        </span>
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          (mono ? "font-mono " : "") +
          "mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-3 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        }
      />
    </label>
  );
}
