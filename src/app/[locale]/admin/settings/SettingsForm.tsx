"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { Check, Loader2, Save } from "lucide-react";

export type SettingsValues = {
  payee_name: string;
  payee_bank: string;
  payee_rib: string;
  payee_iban: string;
  payee_d17: string;
};

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const { toast } = useToast();
  const [v, setV] = useState<SettingsValues>(initial);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function patch<K extends keyof SettingsValues>(key: K, val: SettingsValues[K]) {
    setV((s) => ({ ...s, [key]: val }));
    setSaved(false);
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
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
      <Section
        title="Coordonnées du bénéficiaire"
        hint="Affichées au vendeur sur la page de paiement. Un moyen de paiement n'est proposé que si ses coordonnées sont renseignées."
      >
        <TextField label="Bénéficiaire" value={v.payee_name} onChange={(x) => patch("payee_name", x)} />
        <TextField label="Banque" value={v.payee_bank} onChange={(x) => patch("payee_bank", x)} />
        <TextField label="RIB" mono value={v.payee_rib} onChange={(x) => patch("payee_rib", x)} />
        <TextField label="IBAN" mono value={v.payee_iban} onChange={(x) => patch("payee_iban", x)} />
        <TextField label="Numéro D17" mono value={v.payee_d17} onChange={(x) => patch("payee_d17", x)} />
      </Section>

      <div className="sticky bottom-3 z-10">
        <button
          type="submit"
          disabled={isPending}
          className="mazed-btn-luxe tap-target inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px] disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" strokeWidth={2.5} /> : <Save className="size-4" strokeWidth={2.5} />}
          {isPending ? "Enregistrement…" : saved ? "Enregistré" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title, hint, children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface p-4 ring-1 ring-border">
      <h3 className="text-[14px] font-bold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-[11.5px] text-[var(--foreground-muted)]">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function TextField({
  label, value, onChange, mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={(mono ? "font-mono " : "") + "mazed-input mt-1"}
      />
    </label>
  );
}
