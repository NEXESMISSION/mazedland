"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Send, Loader2, CheckSquare, Square, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatTND } from "@/lib/utils";
import { PayoutRowActions } from "./PayoutRowActions";

export type PayoutRow = {
  id: string;
  seller_id: string;
  amount: number;
  status: "requested" | "processing" | "paid" | "rejected";
  iban: string | null;
  payment_method: string;
  reviewer_notes: string | null;
  processed_at: string | null;
  created_at: string;
  seller: { id: string; full_name: string | null; phone: string | null } | null;
  claimed_by: string | null;
  claimed_by_name: string | null;
};

const STATUS_TONE: Record<string, string> = {
  requested: "batta-tone-warn",
  processing: "batta-tone-warn",
  paid: "batta-tone-ok",
  rejected: "batta-tone-bad",
};
const STATUS_LABEL: Record<string, string> = {
  requested: "En attente",
  processing: "En traitement",
  paid: "Payés",
  rejected: "Refusés",
};
const DEFAULT_REJECT = "IBAN invalide — veuillez soumettre un IBAN tunisien valide.";

/**
 * Client list for the payout queue. Adds multi-select + a status-aware
 * bulk action bar so the admin isn't forced to click through hundreds of
 * withdrawals one row at a time:
 *   · "requested"  → bulk "En traitement" or bulk "Refuser" (shared motif)
 *   · "processing" → bulk "Marquer payé"
 * Each bulk action loops the existing per-payout endpoint, then refreshes.
 * Single-row actions still live in PayoutRowActions.
 */
export function PayoutsList({
  rows,
  status,
  locale,
  meId,
}: {
  rows: PayoutRow[];
  status: string;
  locale: string;
  meId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState(DEFAULT_REJECT);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const busy = progress !== null;

  // Only the work-queue tabs are actionable in bulk.
  const actionable = status === "requested" || status === "processing";

  async function claim(p: PayoutRow, action: "claim" | "release") {
    if (claimBusy || busy) return;
    setClaimBusy(p.id);
    try {
      const res = await fetch(`/api/admin/payouts/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        toast(res.status === 409 ? "Déjà réservé par un autre admin." : "Erreur lors de la réservation.", "error");
        router.refresh();
        return;
      }
      toast(action === "claim" ? "Retrait réservé." : "Réservation libérée.", "success");
      router.refresh();
    } finally {
      setClaimBusy(null);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleAll() {
    setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function runBulk(next: "processing" | "paid" | "rejected", notes?: string) {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    setProgress({ done: 0, total: ids.length });
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`/api/admin/payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, notes: notes ?? null }),
      }).catch(() => null);
      if (res && res.ok) ok += 1;
      else fail += 1;
      setProgress({ done: ok + fail, total: ids.length });
    }
    setProgress(null);
    setRejectOpen(false);
    setReason(DEFAULT_REJECT);
    setSelected(new Set());
    const verb = next === "paid" ? "payé" : next === "processing" ? "passé en traitement" : "refusé";
    toast(
      `${ok} retrait${ok > 1 ? "s" : ""} ${verb}${ok > 1 ? "s" : ""}` + (fail > 0 ? ` · ${fail} échec${fail > 1 ? "s" : ""}` : "."),
      fail > 0 ? "warning" : "success",
    );
    router.refresh();
  }

  return (
    <>
      {actionable && rows.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:border-gold-soft disabled:opacity-50"
          >
            {allOnPage ? <CheckSquare className="size-4 text-gold" /> : <Square className="size-4 text-muted" />}
            Tout sélectionner
          </button>
          {selected.size > 0 && (
            <span className="batta-tabular text-[12px] text-muted">{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      <ul className="mt-5 space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {rows.map((p) => {
          const checked = selected.has(p.id);
          return (
            <li
              key={p.id}
              className={`rounded-xl bg-surface p-4 ring-1 transition ${checked ? "ring-gold" : "ring-border"}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  {actionable && (
                    <button
                      type="button"
                      aria-label={checked ? "Désélectionner" : "Sélectionner"}
                      onClick={() => toggle(p.id)}
                      disabled={busy}
                      className="mt-0.5 shrink-0 disabled:opacity-50"
                    >
                      {checked ? <CheckSquare className="size-4 text-gold" /> : <Square className="size-4 text-muted" />}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-foreground truncate">
                      {p.seller?.full_name ?? "Vendeur"}
                    </div>
                    <div className="mt-0.5 text-[10px] font-mono text-gold">
                      {p.seller_id.slice(0, 8)}…
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      Demandé le{" "}
                      {new Date(p.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                      {p.processed_at && (
                        <>
                          {" · Traité le "}
                          {new Date(p.processed_at).toLocaleString("fr-FR", { dateStyle: "medium" })}
                        </>
                      )}
                    </div>
                    {p.iban && (
                      <div className="mt-1 text-[11px] text-muted font-mono">IBAN {p.iban}</div>
                    )}
                    {p.seller?.phone && (
                      <div className="mt-1 text-[11px] text-muted">Tél {p.seller.phone}</div>
                    )}
                    {p.reviewer_notes && (
                      <div className="batta-tone-bad mt-2 rounded-md px-2 py-1 text-[10.5px]">
                        <span className="font-bold uppercase tracking-wider">Motif :</span> {p.reviewer_notes}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="batta-tabular text-[18px] font-extrabold gradient-gold-text">
                    {formatTND(Number(p.amount), locale)}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${
                      STATUS_TONE[p.status] ?? "bg-surface-2 text-muted ring-1 ring-border"
                    }`}
                  >
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </div>
              </div>
              <div aria-hidden className="batta-hairline mt-3" />
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {actionable && (() => {
                  const mineClaim = !!p.claimed_by && p.claimed_by === meId;
                  const otherClaim = !!p.claimed_by && p.claimed_by !== meId;
                  const cb = claimBusy === p.id;
                  if (otherClaim) {
                    return (
                      <button
                        type="button"
                        onClick={() => claim(p, "claim")}
                        disabled={cb || busy}
                        title="Réservé par un autre admin — cliquez pour reprendre (si abandonné)"
                        className="me-auto inline-flex items-center gap-1 rounded-full batta-tone-warn px-2.5 py-1 text-[10px] font-bold disabled:opacity-50"
                      >
                        {cb ? <Loader2 className="size-3 animate-spin" /> : <Lock className="size-3" />}
                        Réservé · {p.claimed_by_name ?? "autre admin"}
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => claim(p, mineClaim ? "release" : "claim")}
                      disabled={cb || busy}
                      className={`me-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold transition disabled:opacity-50 ${
                        mineClaim ? "batta-tone-ok" : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground"
                      }`}
                    >
                      {cb ? <Loader2 className="size-3 animate-spin" /> : mineClaim ? <LockOpen className="size-3" /> : <Lock className="size-3" />}
                      {mineClaim ? "Réservé par vous · libérer" : "Réserver"}
                    </button>
                  );
                })()}
                <PayoutRowActions id={p.id} status={p.status} />
              </div>
            </li>
          );
        })}
      </ul>

      {/* Sticky bulk-action bar */}
      {actionable && selected.size > 0 && (
        <div className="sticky bottom-4 z-40 mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_18px_45px_-18px_rgba(0,0,0,0.5)] ring-1 ring-gold-soft/60">
          <span className="text-[13px] font-bold text-foreground">
            {progress
              ? `Traitement ${progress.done}/${progress.total}…`
              : `${selected.size} retrait${selected.size > 1 ? "s" : ""} sélectionné${selected.size > 1 ? "s" : ""}`}
          </span>
          <div className="ms-auto flex flex-wrap gap-2">
            {status === "requested" && (
              <>
                <Button size="sm" variant="danger" onClick={() => { setReason(DEFAULT_REJECT); setRejectOpen(true); }} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                  Refuser ({selected.size})
                </Button>
                <Button size="sm" variant="secondary" onClick={() => runBulk("processing")} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  En traitement ({selected.size})
                </Button>
              </>
            )}
            {status === "processing" && (
              <Button size="sm" onClick={() => runBulk("paid")} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Marquer payé ({selected.size})
              </Button>
            )}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={busy}
              className="rounded-lg px-2.5 text-[12px] font-semibold text-muted hover:text-foreground disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Bulk reject modal */}
      {rejectOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => { if (!busy) setRejectOpen(false); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-[var(--surface)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-foreground">
              Refuser {selected.size} retrait{selected.size > 1 ? "s" : ""}
            </h3>
            <p className="mt-1 text-[12px] text-[var(--foreground-muted)] leading-relaxed">
              Le même motif sera enregistré pour chaque retrait sélectionné et visible par le vendeur.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={500}
              autoFocus
              className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/40 p-2.5 text-[13px] font-medium text-foreground focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/40"
            />
            <div className="mt-1 text-[10px] text-[var(--foreground-muted)] text-end">{reason.length} / 500</div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejectOpen(false)}
                className="flex-1 h-10 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px]"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy || reason.trim().length < 5}
                onClick={() => runBulk("rejected", reason.trim())}
                className="flex-1 h-10 rounded-[var(--radius)] bg-red-600 text-white font-bold text-[13px] hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" strokeWidth={2.5} />}
                Refuser la sélection
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
