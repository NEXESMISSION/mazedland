"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { Check, Loader2, Save } from "lucide-react";

type ListingMode = "free" | "fixed" | "percent";

export type SettingsValues = {
  feeListingAuction: { mode: "free" | "fixed"; value: number };
  feeListingDirect: { mode: ListingMode; value: number };
  promoHome: { enabled: boolean; value: number; duration_days: number };
  promoTop: { enabled: boolean; value: number; duration_days: number };
  promoBanner: { enabled: boolean; value: number; duration_days: number };
  deposit: { mode: ListingMode; value: number; free_until: string };
  antiSnipe: { window_min: number; extend_min: number };
  auctionTypes: { dutch_enabled: boolean; sealed_enabled: boolean };
  finalPaymentDays: number;
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
      const payload = {
        fee_listing_auction: v.feeListingAuction,
        fee_listing_direct: v.feeListingDirect,
        promo_home: v.promoHome,
        promo_top: v.promoTop,
        promo_banner: v.promoBanner,
        deposit: { ...v.deposit, free_until: v.deposit.free_until || null },
        auction_antisnipe: v.antiSnipe,
        auction_types: v.auctionTypes,
        final_payment_days: { days: v.finalPaymentDays },
        payee_name: v.payee_name,
        payee_bank: v.payee_bank,
        payee_rib: v.payee_rib,
        payee_iban: v.payee_iban,
        payee_d17: v.payee_d17,
      };
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      {/* ── Posting fees ── */}
      <Section
        title="Frais de publication"
        hint="Ce que le vendeur paie pour publier. Gratuit, montant fixe, ou pourcentage."
      >
        <FeeRow
          label="Enchère"
          modes={["free", "fixed"]}
          mode={v.feeListingAuction.mode}
          value={v.feeListingAuction.value}
          onMode={(m) => patch("feeListingAuction", { ...v.feeListingAuction, mode: m as "free" | "fixed" })}
          onValue={(n) => patch("feeListingAuction", { ...v.feeListingAuction, value: n })}
        />
        <FeeRow
          label="Offre directe"
          modes={["free", "fixed", "percent"]}
          mode={v.feeListingDirect.mode}
          value={v.feeListingDirect.value}
          percentHint="% du prix de vente"
          onMode={(m) => patch("feeListingDirect", { ...v.feeListingDirect, mode: m })}
          onValue={(n) => patch("feeListingDirect", { ...v.feeListingDirect, value: n })}
        />
      </Section>

      {/* ── Promo add-ons ── */}
      <Section
        title="Options payantes"
        hint="Mises en avant proposées au vendeur : prix et durée (en jours) une fois l'annonce validée. Désactivez pour masquer une option."
      >
        <PromoRow label="Mise en avant (accueil)" cfg={v.promoHome} onChange={(c) => patch("promoHome", c)} />
        <PromoRow label="Top de la recherche" cfg={v.promoTop} onChange={(c) => patch("promoTop", c)} />
        <PromoRow label="Bannière d'accueil" cfg={v.promoBanner} onChange={(c) => patch("promoBanner", c)} />
      </Section>

      {/* ── Deposit ── */}
      <Section
        title="Caution pour enchérir"
        hint="Ce qu'un participant verse avant d'enchérir. Pourcentage = % du prix d'ouverture."
      >
        <FeeRow
          label="Caution"
          modes={["free", "fixed", "percent"]}
          mode={v.deposit.mode}
          value={v.deposit.value}
          percentHint="% du prix d'ouverture"
          onMode={(m) => patch("deposit", { ...v.deposit, mode: m })}
          onValue={(n) => patch("deposit", { ...v.deposit, value: n })}
        />
        <label className="block">
          <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">
            Gratuit jusqu&apos;au (optionnel)
          </span>
          <input
            type="date"
            value={v.deposit.free_until}
            onChange={(e) => patch("deposit", { ...v.deposit, free_until: e.target.value })}
            className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-3 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
          />
          <span className="mt-1 block text-[10.5px] text-[var(--foreground-muted)]">
            Pendant cette période, enchérir est gratuit pour tout le monde.
            {v.deposit.free_until && (
              <button
                type="button"
                onClick={() => patch("deposit", { ...v.deposit, free_until: "" })}
                className="ms-1 font-bold text-batta-gold-bright underline"
              >
                Effacer
              </button>
            )}
          </span>
        </label>
      </Section>

      {/* ── Auction formats available to sellers ── */}
      <Section
        title="Formats d'enchère proposés"
        hint="Choisissez les formats que les vendeurs peuvent utiliser. L'enchère anglaise (le prix monte, la plus haute offre gagne) est toujours active — c'est le format standard."
      >
        <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 opacity-80">
          <div>
            <div className="text-[13px] font-bold text-foreground">Anglaise <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]">· standard</span></div>
            <div className="text-[11px] text-[var(--foreground-muted)]">Le prix monte à chaque offre. Toujours disponible.</div>
          </div>
          <span className="text-[11px] font-bold text-[var(--gold)]">Activée</span>
        </div>
        <FormatToggle
          label="Dégressive (Dutch)"
          sub="Le prix baisse avec le temps ; le premier à accepter gagne."
          on={v.auctionTypes.dutch_enabled}
          onChange={(b) => patch("auctionTypes", { ...v.auctionTypes, dutch_enabled: b })}
        />
        <FormatToggle
          label="Cachetée (Sealed)"
          sub="Offres secrètes, révélées à la clôture ; la plus élevée gagne."
          on={v.auctionTypes.sealed_enabled}
          onChange={(b) => patch("auctionTypes", { ...v.auctionTypes, sealed_enabled: b })}
        />
      </Section>

      {/* ── Anti-sniping (auction time extension) ── */}
      <Section
        title="Prolongation d'enchère (anti-snipe)"
        hint="Si une offre arrive juste avant la fin, le temps est prolongé pour laisser les autres réagir. S'applique aux enchères en cours et à venir."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MinutesField
            label="Fenêtre de déclenchement"
            sub="Offre dans les X dernières minutes → prolongation."
            value={v.antiSnipe.window_min}
            onChange={(n) => patch("antiSnipe", { ...v.antiSnipe, window_min: n })}
          />
          <MinutesField
            label="Durée de prolongation"
            sub="On ajoute X minutes à la fin."
            value={v.antiSnipe.extend_min}
            onChange={(n) => patch("antiSnipe", { ...v.antiSnipe, extend_min: n })}
          />
        </div>
        <p className="text-[10.5px] text-[var(--foreground-muted)]">
          Mettez les deux à 0 pour désactiver la prolongation (l&apos;enchère se
          termine à l&apos;heure pile).
        </p>
      </Section>

      {/* ── Winner's final-payment deadline ── */}
      <Section
        title="Délai de paiement du gagnant"
        hint="Temps laissé à l'adjudicataire pour régler le solde après la vente. S'applique aux ventes finalisées après la modification ; affiché à l'acheteur sur la page de l'enchère."
      >
        <DaysField
          label="Délai de paiement final"
          sub="Au-delà, la caution est saisie et le compte banni. Défaut : 14 jours."
          value={v.finalPaymentDays}
          onChange={(n) => patch("finalPaymentDays", n)}
        />
      </Section>

      {/* ── Payee ── */}
      <Section
        title="Coordonnées du bénéficiaire"
        hint="Affichées au payeur sur la page de paiement (virement + D17)."
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
          className="batta-btn-luxe tap-target inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px] disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" strokeWidth={2.5} /> : <Save className="size-4" strokeWidth={2.5} />}
          {isPending ? "Enregistrement…" : saved ? "Enregistré" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

const MODE_LABEL: Record<ListingMode, string> = {
  free: "Gratuit",
  fixed: "Montant fixe",
  percent: "Pourcentage",
};

function FormatToggle({
  label, sub, on, onChange,
}: {
  label: string;
  sub: string;
  on: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-surface px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-foreground">{label}</div>
        <div className="text-[11px] text-[var(--foreground-muted)]">{sub}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          on ? "bg-[var(--gold)]" : "bg-[var(--surface-2)] ring-1 ring-[var(--border)]"
        }`}
      >
        <span
          className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function FeeRow({
  label, modes, mode, value, percentHint, onMode, onValue,
}: {
  label: string;
  modes: ListingMode[];
  mode: ListingMode;
  value: number;
  percentHint?: string;
  onMode: (m: ListingMode) => void;
  onValue: (n: number) => void;
}) {
  return (
    <div className="rounded-xl border border-batta-gold/20 bg-batta-surface-2 p-3">
      <div className="text-[12px] font-bold text-batta-cream">{label}</div>
      <div className="mt-2 inline-flex rounded-lg bg-batta-surface p-0.5 ring-1 ring-batta-gold/20">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onMode(m)}
            className={
              "rounded-md px-3 py-1.5 text-[11px] font-bold transition " +
              (mode === m
                ? "bg-batta-gold text-white"
                : "text-foreground/70 hover:text-batta-gold-bright")
            }
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {mode !== "free" && (
        <div className="mt-2 flex items-stretch overflow-hidden rounded-lg border border-batta-gold/25 bg-batta-surface focus-within:border-batta-gold">
          <input
            type="number"
            step={mode === "percent" ? "0.5" : "0.01"}
            min={0}
            max={mode === "percent" ? 100 : undefined}
            value={Number.isFinite(value) ? value : 0}
            onChange={(e) => onValue(Number(e.target.value) || 0)}
            className="batta-tabular flex-1 bg-transparent px-3 py-2 text-sm text-batta-cream focus:outline-none"
          />
          <span className="inline-flex items-center px-3 text-[11px] font-bold text-[var(--foreground-muted)]">
            {mode === "percent" ? "%" : "TND"}
          </span>
        </div>
      )}
      {mode === "percent" && percentHint && (
        <p className="mt-1 text-[10.5px] text-[var(--foreground-muted)]">{percentHint}</p>
      )}
    </div>
  );
}

function PromoRow({
  label, cfg, onChange,
}: {
  label: string;
  cfg: { enabled: boolean; value: number; duration_days: number };
  onChange: (c: { enabled: boolean; value: number; duration_days: number }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-batta-gold/20 bg-batta-surface-2 p-3">
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => onChange({ ...cfg, enabled: e.target.checked })}
          className="size-4 accent-batta-gold-bright"
        />
        <span className="text-[12px] font-semibold text-batta-cream">{label}</span>
      </label>
      <div className="ms-auto flex items-center gap-2">
        {/* Price */}
        <div className="flex items-stretch overflow-hidden rounded-lg border border-batta-gold/25 bg-batta-surface focus-within:border-batta-gold">
          <input
            type="number"
            step="0.01"
            min={0}
            disabled={!cfg.enabled}
            value={Number.isFinite(cfg.value) ? cfg.value : 0}
            onChange={(e) => onChange({ ...cfg, value: Number(e.target.value) || 0 })}
            className="batta-tabular w-20 bg-transparent px-3 py-2 text-sm text-batta-cream focus:outline-none disabled:opacity-40"
            aria-label={`${label} — prix`}
          />
          <span className="inline-flex items-center px-2.5 text-[11px] font-bold text-[var(--foreground-muted)]">TND</span>
        </div>
        {/* Active duration in days */}
        <div className="flex items-stretch overflow-hidden rounded-lg border border-batta-gold/25 bg-batta-surface focus-within:border-batta-gold">
          <input
            type="number"
            step="1"
            min={1}
            max={365}
            disabled={!cfg.enabled}
            value={Number.isFinite(cfg.duration_days) ? cfg.duration_days : 30}
            onChange={(e) => onChange({ ...cfg, duration_days: Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 0))) })}
            className="batta-tabular w-16 bg-transparent px-3 py-2 text-sm text-batta-cream focus:outline-none disabled:opacity-40"
            aria-label={`${label} — durée en jours`}
          />
          <span className="inline-flex items-center px-2.5 text-[11px] font-bold text-[var(--foreground-muted)]">jours</span>
        </div>
      </div>
    </div>
  );
}

function MinutesField({
  label, sub, value, onChange,
}: {
  label: string;
  sub?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="rounded-xl border border-batta-gold/20 bg-batta-surface-2 p-3">
      <div className="text-[12px] font-bold text-batta-cream">{label}</div>
      {sub && <p className="mt-0.5 text-[10.5px] text-[var(--foreground-muted)]">{sub}</p>}
      <div className="mt-2 flex items-stretch overflow-hidden rounded-lg border border-batta-gold/25 bg-batta-surface focus-within:border-batta-gold">
        <input
          type="number"
          step="1"
          min={0}
          max={120}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.min(120, Math.floor(Number(e.target.value) || 0))))}
          className="batta-tabular flex-1 bg-transparent px-3 py-2 text-sm text-batta-cream focus:outline-none"
          aria-label={label}
        />
        <span className="inline-flex items-center px-3 text-[11px] font-bold text-[var(--foreground-muted)]">
          min
        </span>
      </div>
    </div>
  );
}

function DaysField({
  label, sub, value, onChange,
}: {
  label: string;
  sub?: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="rounded-xl border border-batta-gold/20 bg-batta-surface-2 p-3">
      <div className="text-[12px] font-bold text-batta-cream">{label}</div>
      {sub && <p className="mt-0.5 text-[10.5px] text-[var(--foreground-muted)]">{sub}</p>}
      <div className="mt-2 flex items-stretch overflow-hidden rounded-lg border border-batta-gold/25 bg-batta-surface focus-within:border-batta-gold">
        <input
          type="number"
          step="1"
          min={1}
          max={90}
          value={Number.isFinite(value) ? value : 14}
          onChange={(e) => onChange(Math.max(1, Math.min(90, Math.floor(Number(e.target.value) || 1))))}
          className="batta-tabular flex-1 bg-transparent px-3 py-2 text-sm text-batta-cream focus:outline-none"
          aria-label={label}
        />
        <span className="inline-flex items-center px-3 text-[11px] font-bold text-[var(--foreground-muted)]">
          jours
        </span>
      </div>
    </div>
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
        className={(mono ? "font-mono " : "") + "mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-3 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"}
      />
    </label>
  );
}
