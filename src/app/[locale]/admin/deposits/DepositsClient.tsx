"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { formatTND } from "@/lib/utils";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import {
  Loader2, Check, CircleDollarSign, Gavel, ShieldX, FileText, CheckCircle2,
  Search, MapPin, X, ExternalLink,
} from "lucide-react";

export type DepositRow = {
  id: string;
  amount: number;
  bidder: string;
  auctionId: string | null;
  status: string;
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

const STATUS_LABEL: Record<string, string> = {
  ended_sold: "Adjugée",
  awarded: "Adjugée",
  ended_unsold: "Invendue",
  cancelled: "Annulée",
  sixth_offer_window: "Surenchère",
};

type Group = {
  auctionId: string | null;
  title: string;
  governorate: string;
  status: string;
  deposits: DepositRow[];
  total: number;
};

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
  const [bulkAuction, setBulkAuction] = useState<string | null>(null);
  const [bulkRef, setBulkRef] = useState("");
  const [, start] = useTransition();

  // ── Filters ──
  const [q, setQ] = useState("");
  const [gov, setGov] = useState("all");

  const govs = useMemo(
    () => Array.from(new Set(toRefund.map((d) => d.governorate).filter(Boolean))).sort(),
    [toRefund],
  );

  // Filter, then group the to-refund queue BY AUCTION so each lot is
  // managed as a unit (total + count + bulk action) instead of a flat list.
  const groups = useMemo<Group[]>(() => {
    const term = q.trim().toLowerCase();
    const filtered = toRefund.filter((d) => {
      if (gov !== "all" && d.governorate !== gov) return false;
      if (term && !d.title.toLowerCase().includes(term) && !d.bidder.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
    const map = new Map<string, Group>();
    for (const d of filtered) {
      const key = d.auctionId ?? d.id;
      const g = map.get(key) ?? {
        auctionId: d.auctionId,
        title: d.title,
        governorate: d.governorate,
        status: d.status,
        deposits: [],
        total: 0,
      };
      g.deposits.push(d);
      g.total += d.amount;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.deposits.length - a.deposits.length);
  }, [toRefund, q, gov]);

  const filteredCount = groups.reduce((n, g) => n + g.deposits.length, 0);
  const filteredTotal = groups.reduce((n, g) => n + g.total, 0);

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

  // Refund every deposit of one auction in one pass, with a single shared ref.
  async function refundAll(group: Group) {
    const key = `bulk-${group.auctionId}`;
    setBusy(key);
    let ok = 0;
    try {
      for (const d of group.deposits) {
        const res = await fetch("/api/admin/deposits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "refund", depositId: d.id, ref: bulkRef.trim() }),
        });
        if (res.ok) ok += 1;
      }
    } finally {
      setBusy(null);
      setBulkAuction(null);
      setBulkRef("");
    }
    toast(
      ok === group.deposits.length
        ? `${ok} caution${ok > 1 ? "s" : ""} marquée${ok > 1 ? "s" : ""} remboursée${ok > 1 ? "s" : ""}.`
        : `${ok}/${group.deposits.length} remboursées — réessayez le reste.`,
      ok === group.deposits.length ? "success" : "warning",
    );
    start(() => router.refresh());
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
                    {a.lockedCount} caution{a.lockedCount > 1 ? "s" : ""} à libérer ·{" "}
                    {STATUS_LABEL[a.status] ?? a.status}
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

      {/* 2. To-refund queue — grouped by auction, with filters + summary */}
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
          <>
            {/* Summary + filters */}
            <div className="mb-3 rounded-2xl bg-surface p-3 ring-1 ring-border">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] text-muted">
                  <span className="batta-tabular font-extrabold text-foreground">{filteredCount}</span>{" "}
                  caution{filteredCount > 1 ? "s" : ""} ·{" "}
                  <span className="batta-tabular font-extrabold text-foreground">{fmt(filteredTotal)}</span>{" "}
                  à rembourser ·{" "}
                  <span className="batta-tabular font-bold text-foreground">{groups.length}</span>{" "}
                  enchère{groups.length > 1 ? "s" : ""}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" strokeWidth={2} />
                    <input
                      type="search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Bien ou acheteur…"
                      className="h-9 w-52 rounded-lg border border-border bg-surface-2 pl-8 pr-3 text-[12px] text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
                    />
                  </div>
                  {govs.length > 1 && (
                    <select
                      value={gov}
                      onChange={(e) => setGov(e.target.value)}
                      className="h-9 rounded-lg border border-border bg-surface-2 px-2.5 text-[12px] font-semibold text-foreground focus:border-gold focus:outline-none"
                      aria-label="Filtrer par gouvernorat"
                    >
                      <option value="all">Tous les gouvernorats</option>
                      {govs.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  )}
                  {(q || gov !== "all") && (
                    <button
                      type="button"
                      onClick={() => { setQ(""); setGov("all"); }}
                      className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      <X className="size-3.5" /> Réinitialiser
                    </button>
                  )}
                </div>
              </div>
            </div>

            {groups.length === 0 ? (
              <Empty text="Aucune caution ne correspond à ce filtre." />
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g.auctionId ?? g.deposits[0].id} className="overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
                    {/* Auction header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2/50 px-4 py-3">
                      <div className="min-w-0">
                        {g.auctionId ? (
                          <Link
                            href={`/admin/auctions/${g.auctionId}`}
                            className="group/h inline-flex items-center gap-1.5 text-[13.5px] font-bold text-foreground hover:text-gold"
                          >
                            <Gavel className="size-3.5 shrink-0 text-gold" strokeWidth={2.2} />
                            <span className="truncate">{g.title}</span>
                            <ExternalLink className="size-3 shrink-0 opacity-0 transition group-hover/h:opacity-100" />
                          </Link>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-foreground">
                            <Gavel className="size-3.5 shrink-0 text-gold" strokeWidth={2.2} />
                            <span className="truncate">{g.title}</span>
                          </div>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                          {g.governorate && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3" /> {g.governorate}
                            </span>
                          )}
                          <span aria-hidden className="opacity-40">·</span>
                          <span>{STATUS_LABEL[g.status] ?? g.status}</span>
                          <span aria-hidden className="opacity-40">·</span>
                          <span className="batta-tabular">
                            {g.deposits.length} caution{g.deposits.length > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">À rembourser</div>
                          <div className="batta-tabular text-[15px] font-extrabold text-foreground">{fmt(g.total)}</div>
                        </div>
                        {g.deposits.length > 1 && bulkAuction !== g.auctionId && (
                          <button
                            type="button"
                            onClick={() => { setBulkAuction(g.auctionId); setBulkRef(""); }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                          >
                            <CircleDollarSign className="size-3.5" /> Tout rembourser
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Bulk-refund ref bar */}
                    {bulkAuction === g.auctionId && (
                      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-emerald-500/5 px-4 py-3">
                        <input
                          type="text"
                          value={bulkRef}
                          autoFocus
                          onChange={(e) => setBulkRef(e.target.value)}
                          placeholder="Réf. virement commune (optionnel)"
                          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px] text-foreground focus:border-gold focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={busy === `bulk-${g.auctionId}`}
                          onClick={() => refundAll(g)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                        >
                          {busy === `bulk-${g.auctionId}` ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" strokeWidth={2.5} />}
                          Confirmer les {g.deposits.length}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setBulkAuction(null); setBulkRef(""); }}
                          className="rounded-lg px-2.5 py-2 text-[12px] font-semibold text-muted hover:text-foreground"
                        >
                          Annuler
                        </button>
                      </div>
                    )}

                    {/* Per-bidder deposit rows */}
                    <ul className="divide-y divide-border">
                      {g.deposits.map((d) => (
                        <li key={d.id} className="p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="batta-tabular text-[15px] font-extrabold text-foreground">{fmt(d.amount)}</div>
                              <div className="mt-0.5 text-[12px] font-semibold text-foreground">{d.bidder}</div>
                            </div>
                            {d.receiptUrl && (
                              <ImageLightbox
                                src={d.receiptUrl}
                                alt="Reçu de caution"
                                triggerClassName="relative size-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-border"
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
                  </div>
                ))}
              </div>
            )}
          </>
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
