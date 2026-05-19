"use client";

import { useRef, useState, useTransition } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useLocale } from "next-intl";
import { formatTND } from "@/lib/utils";

type Inspector = { id: string; speciality: string; rating_avg: number; full_name: string };

const KIND_FEES = {
  // Plan §7 inspector pricing — TND
  standard: { label: "Inspection standard (appartement / petite maison)", min: 200, max: 300 },
  full: { label: "Inspection complète (villa, commercial, terrain)", min: 500, max: 800 },
  virtual_live: { label: "Visite virtuelle en direct (pour la diaspora)", min: 300, max: 500 },
} as const;

type Kind = keyof typeof KIND_FEES;

export function BookInspectionForm({
  propertyId,
  inspectors,
}: {
  propertyId: string;
  inspectors: Inspector[];
}) {
  const locale = useLocale();
  const [kind, setKind] = useState<Kind>("standard");
  const [inspectorId, setInspectorId] = useState<string>(inspectors[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Persist the inspection id we just created so a failure in the
  // /api/payments/initiate step lets the user retry without creating
  // a second inspection row. Same pattern as the SellForm resume state.
  const inspectionIdRef = useRef<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!inspectorId) {
      setError("Aucun inspecteur disponible dans ce gouvernorat pour le moment.");
      return;
    }
    // Don't let a typo book yesterday. The inspector can still adjust
    // the slot after acceptance.
    if (scheduledAt) {
      const picked = new Date(scheduledAt).getTime();
      if (Number.isNaN(picked) || picked < Date.now() - 5 * 60_000) {
        setError("Choisissez un créneau dans le futur.");
        return;
      }
    }
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Vous devez être connecté.");
        return;
      }

      // Step 1 — create the inspection (or reuse the one we already
      // created on a previous failed attempt).
      let inspectionId = inspectionIdRef.current;
      if (!inspectionId) {
        const { data, error } = await supabase
          .from("inspections")
          .insert({
            property_id: propertyId,
            requested_by: user.id,
            inspector_id: inspectorId,
            kind,
            scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
            // Use the lower bound as the upfront commitment; the platform
            // adjusts after the inspector confirms scope.
            fee_amount: KIND_FEES[kind].min,
            status: "requested",
          })
          .select("id")
          .single();
        if (error || !data) {
          setError(error?.message ?? "Impossible de créer l'inspection.");
          return;
        }
        inspectionId = data.id as string;
        inspectionIdRef.current = inspectionId;
      }

      // Step 2 — kick the user into the manual receipt-upload flow.
      // /payment/initiate creates a `payments` row with status='pending'
      // and returns its id; the checkout page handles provider choice +
      // bank/D17 instructions + receipt upload (no gateway redirect).
      const initRes = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "inspection_fee",
          amount: KIND_FEES[kind].min,
          inspection_id: inspectionId,
        }),
      });
      if (!initRes.ok) {
        setError("Impossible de démarrer le paiement. Réessayez.");
        return;
      }
      const init = (await initRes.json()) as { paymentId: string };
      window.location.href = `/payment/checkout?payment=${init.paymentId}`;
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-batta-muted">Type d&apos;inspection</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        >
          {(Object.keys(KIND_FEES) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_FEES[k].label} — {formatTND(KIND_FEES[k].min, locale)}–{formatTND(KIND_FEES[k].max, locale)} TND
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-batta-muted">Inspecteur</span>
        <select
          value={inspectorId}
          onChange={(e) => setInspectorId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        >
          {inspectors.length === 0 && <option value="">— aucun dans votre gouvernorat —</option>}
          {inspectors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.full_name} · {i.speciality.replace(/_/g, " ")} · ⭐ {i.rating_avg.toFixed(1)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-batta-muted">Créneau préféré</span>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        />
      </label>

      {error && <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? "…" : "Continuer vers le paiement"}
      </button>
    </form>
  );
}
