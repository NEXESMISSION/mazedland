"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useLocale } from "next-intl";
import { formatTND } from "@/lib/utils";

type Inspector = { id: string; speciality: string; rating_avg: number; full_name: string };

const KIND_FEES = {
  // Plan §7 inspector pricing — TND
  standard: { label: "Standard inspection (apartment / small home)", min: 200, max: 300 },
  full: { label: "Full inspection (villa, commercial, land)", min: 500, max: 800 },
  virtual_live: { label: "Live virtual tour (for diaspora)", min: 300, max: 500 },
} as const;

type Kind = keyof typeof KIND_FEES;

export function BookInspectionForm({
  propertyId,
  inspectors,
}: {
  propertyId: string;
  inspectors: Inspector[];
}) {
  const router = useRouter();
  const locale = useLocale();
  const [kind, setKind] = useState<Kind>("standard");
  const [inspectorId, setInspectorId] = useState<string>(inspectors[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!inspectorId) {
      setError("No inspector available in this governorate yet.");
      return;
    }
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
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
      if (error) {
        setError(error.message);
        return;
      }

      // Kick the user into the manual receipt-upload flow.
      // /payment/initiate now creates a `payments` row with status='pending'
      // and returns its id; the checkout page handles provider choice +
      // bank/D17 instructions + receipt upload (no gateway redirect).
      const initRes = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "inspection_fee",
          amount: KIND_FEES[kind].min,
          inspection_id: data.id,
        }),
      });
      if (!initRes.ok) {
        setError("Could not start payment");
        return;
      }
      const init = (await initRes.json()) as { paymentId: string };
      window.location.href = `/payment/checkout?payment=${init.paymentId}`;
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-batta-muted">Inspection type</span>
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
        <span className="text-xs font-medium text-batta-muted">Inspector</span>
        <select
          value={inspectorId}
          onChange={(e) => setInspectorId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        >
          {inspectors.length === 0 && <option value="">— none in your governorate —</option>}
          {inspectors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.full_name} · {i.speciality.replace(/_/g, " ")} · ⭐ {i.rating_avg.toFixed(1)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-batta-muted">Preferred slot</span>
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
        {isPending ? "…" : "Continue to payment"}
      </button>
    </form>
  );
}
