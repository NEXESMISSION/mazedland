"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { formatTND } from "@/lib/utils";
import { Loader2, Check, CircleDollarSign, ShieldX } from "lucide-react";

export type CautionRow = {
  id: string;
  bidder: string;
  amount: number;
  state: "locked" | "to_refund" | "refunded" | "forfeited";
  refundRef: string | null;
};

const fmt = (n: number) => `${formatTND(n, "fr")} TND`;
const STATE = {
  locked: { label: "Bloquée", tone: "bg-surface-2 text-muted ring-1 ring-border" },
  to_refund: { label: "À rembourser", tone: "batta-tone-warn" },
  refunded: { label: "Remboursée", tone: "batta-tone-ok" },
  forfeited: { label: "Confisquée", tone: "batta-tone-bad" },
} as const;

/** Actionable caution list for the per-auction page: prepare (release the
 *  whole lot), then mark each released caution refunded or forfeited. */
export function CautionActions({ auctionId, deposits }: { auctionId: string; deposits: CautionRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [, start] = useTransition();

  const lockedCount = deposits.filter((d) => d.state === "locked").length;

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/deposits", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast(j.error ?? "Action échouée.", "error"); return false; }
      return true;
    } finally { setBusy(null); }
  }

  return (
    <div>
      {lockedCount > 0 && (
        <button
          type="button"
          disabled={busy === "prep"}
          onClick={async () => {
            if (await post({ action: "prepare", auctionId }, "prep")) {
              toast("Remboursements préparés.", "success");
              start(() => router.refresh());
            }
          }}
          className="batta-btn-luxe mb-3 inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] disabled:opacity-50"
        >
          {busy === "prep" ? <Loader2 className="size-3.5 animate-spin" /> : <CircleDollarSign className="size-3.5" />}
          Préparer les remboursements ({lockedCount})
        </button>
      )}

      <ul className="space-y-2">
        {deposits.map((d) => (
          <li key={d.id} className="rounded-xl bg-surface p-3.5 ring-1 ring-border">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-foreground">{d.bidder}</div>
                <div className="batta-tabular mt-0.5 text-[12px] text-muted">
                  {fmt(d.amount)}{d.refundRef ? ` · réf. ${d.refundRef}` : ""}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.12em] ${STATE[d.state].tone}`}>
                {STATE[d.state].label}
              </span>
            </div>

            {d.state === "to_refund" && (
              refundingId === d.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text" value={ref} autoFocus onChange={(e) => setRef(e.target.value)}
                    placeholder="Réf. du virement (optionnel)"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] focus:border-gold focus:outline-none"
                  />
                  <button
                    type="button" disabled={busy === `ref-${d.id}`}
                    onClick={async () => {
                      if (await post({ action: "refund", depositId: d.id, ref: ref.trim() }, `ref-${d.id}`)) {
                        toast("Caution remboursée.", "success"); setRefundingId(null); setRef(""); start(() => router.refresh());
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    {busy === `ref-${d.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" strokeWidth={2.5} />} Confirmer
                  </button>
                  <button type="button" onClick={() => { setRefundingId(null); setRef(""); }} className="rounded-lg px-2.5 py-2 text-[12px] font-semibold text-muted hover:text-foreground">Annuler</button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <button type="button" onClick={() => { setRefundingId(d.id); setRef(""); }} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/30">
                    <CircleDollarSign className="size-3.5" /> Marquer remboursée
                  </button>
                  <button type="button" disabled={busy === `forf-${d.id}`}
                    onClick={async () => {
                      if (await post({ action: "forfeit", depositId: d.id }, `forf-${d.id}`)) {
                        toast("Caution confisquée.", "warning"); start(() => router.refresh());
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                    <ShieldX className="size-3.5" /> Confisquer
                  </button>
                </div>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
