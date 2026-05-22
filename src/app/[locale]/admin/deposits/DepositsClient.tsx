"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { formatTND } from "@/lib/utils";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import {
  Loader2, Check, CircleDollarSign, Gavel, ShieldX, FileText, CheckCircle2,
} from "lucide-react";

export type DepositRow = {
  id: string;
  amount: number;
  bidder: string;
  auctionId: string | null;
  title: string;
  governorate: string;
  refundRef: string | null;
  refundedAt: string | null;
  receiptUrl: string | null;
};

export type PrepareRow = {
  auctionId: string;
  title: string;
  status: string;
  lockedCount: number;
};

const fmt = (n: number) => `${formatTND(n, "fr")} TND`;

export function DepositsClient({
  toPrepare, toRefund, refunded,
}: {
  toPrepare: PrepareRow[];
  toRefund: DepositRow[];
  refunded: DepositRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [, start] = useTransition();

  async function post(bodyObj: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(j.error ?? "Action échouée.", "error");
        return false;
      }
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function prepare(auctionId: string) {
    if (await post({ action: "prepare", auctionId }, `prep-${auctionId}`)) {
      toast("Remboursements préparés.", "success");
      start(() => router.refresh());
    }
  }
  async function refund(depositId: string) {
    if (await post({ action: "refund", depositId, ref: ref.trim() }, `ref-${depositId}`)) {
      toast("Caution marquée remboursée.", "success");
      setRefundingId(null);
      setRef("");
      start(() => router.refresh());
    }
  }
  async function forfeit(depositId: string) {
    if (await post({ action: "forfeit", depositId }, `forf-${depositId}`)) {
      toast("Caution confisquée.", "warning");
      start(() => router.refresh());
    }
  }

  return (
    <div className="mt-5 space-y-6">
      {/* 1. Auctions to prepare */}
      <section>
        <h3 className="batta-eyebrow mb-2 flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Enchères terminées à préparer
        </h3>
        {toPrepare.length === 0 ? (
          <Empty text="Aucune enchère en attente de préparation." />
        ) : (
          <ul className="space-y-2">
            {toPrepare.map((a) => (
              <li
                key={a.auctionId}
                className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-border"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold text-foreground">{a.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {a.lockedCount} caution{a.lockedCount > 1 ? "s" : ""} à libérer · {a.status}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy === `prep-${a.auctionId}`}
                  onClick={() => prepare(a.auctionId)}
                  className="batta-btn-luxe tap-target inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-[12px] disabled:opacity-50"
                >
                  {busy === `prep-${a.auctionId}` ? <Loader2 className="size-3.5 animate-spin" /> : <CircleDollarSign className="size-3.5" />}
                  Préparer les remboursements
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. To-refund queue */}
      <section>
        <h3 className="batta-eyebrow mb-2 flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Cautions à rembourser
          {toRefund.length > 0 && (
            <span className="ml-1 rounded-full batta-tone-warn px-2 py-0.5 text-[10px] font-extrabold">
              {toRefund.length}
            </span>
          )}
        </h3>
        {toRefund.length === 0 ? (
          <Empty text="Rien à rembourser pour le moment." />
        ) : (
          <ul className="space-y-2.5">
            {toRefund.map((d) => (
              <li key={d.id} className="rounded-2xl bg-surface p-3.5 ring-1 ring-border">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="batta-tabular text-[17px] font-extrabold text-foreground">{fmt(d.amount)}</div>
                    <div className="mt-0.5 text-[12px] font-semibold text-foreground">{d.bidder}</div>
                    <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                      <Gavel className="size-3" /> {d.title}{d.governorate ? ` · ${d.governorate}` : ""}
                    </div>
                  </div>
                  {d.receiptUrl && (
                    <ImageLightbox
                      src={d.receiptUrl}
                      alt="Reçu de caution"
                      triggerClassName="relative size-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={d.receiptUrl} alt="Reçu" className="size-full object-cover" />
                    </ImageLightbox>
                  )}
                </div>

                {refundingId === d.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={ref}
                      autoFocus
                      onChange={(e) => setRef(e.target.value)}
                      placeholder="Référence du virement (optionnel)"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-foreground focus:border-gold focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy === `ref-${d.id}`}
                      onClick={() => refund(d.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                      {busy === `ref-${d.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" strokeWidth={2.5} />}
                      Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRefundingId(null); setRef(""); }}
                      className="rounded-lg px-2.5 py-2 text-[12px] font-semibold text-muted hover:text-foreground"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setRefundingId(d.id); setRef(""); }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                    >
                      <CircleDollarSign className="size-3.5" /> Marquer remboursée
                    </button>
                    <button
                      type="button"
                      disabled={busy === `forf-${d.id}`}
                      onClick={() => forfeit(d.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <ShieldX className="size-3.5" /> Confisquer
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Recent refunds */}
      {refunded.length > 0 && (
        <section>
          <h3 className="batta-eyebrow mb-2 flex items-center gap-2">
            <span aria-hidden className="batta-gold-rule-short" />
            Remboursements récents
          </h3>
          <ul className="space-y-1.5">
            {refunded.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-border"
              >
                <div className="min-w-0 inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  <span className="truncate text-[12.5px] text-foreground">
                    {d.bidder} · {d.title}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="batta-tabular text-[12.5px] font-bold text-foreground">{fmt(d.amount)}</div>
                  {d.refundRef && (
                    <div className="inline-flex items-center gap-1 text-[10px] text-muted">
                      <FileText className="size-2.5" /> {d.refundRef}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted">
      {text}
    </div>
  );
}
