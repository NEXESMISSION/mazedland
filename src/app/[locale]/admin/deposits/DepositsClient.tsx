"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTND } from "@/lib/utils";
import {
  Gavel, MapPin, CheckCircle2, FileText, Search, X, ChevronRight, CircleDollarSign,
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

type Box = { auctionId: string | null; title: string; gov: string; count: number; total: number };

/**
 * Remboursements — a clickable BOX per auction. Each box opens
 * /admin/auctions/[id] where cautions are actually prepared / refunded /
 * forfeited. The list stays a light summary (no inline action rows).
 */
export function DepositsClient({
  toPrepare, toRefund, refunded,
}: {
  toPrepare: PrepareRow[];
  toRefund: DepositRow[];
  refunded: DepositRow[];
}) {
  const [q, setQ] = useState("");
  const [gov, setGov] = useState("all");

  const govs = useMemo(
    () => Array.from(new Set(toRefund.map((d) => d.governorate).filter(Boolean))).sort(),
    [toRefund],
  );

  const boxes = useMemo<Box[]>(() => {
    const term = q.trim().toLowerCase();
    const map = new Map<string, Box>();
    for (const d of toRefund) {
      if (gov !== "all" && d.governorate !== gov) continue;
      if (term && !d.title.toLowerCase().includes(term) && !d.bidder.toLowerCase().includes(term)) continue;
      const key = d.auctionId ?? d.id;
      const b = map.get(key) ?? { auctionId: d.auctionId, title: d.title, gov: d.governorate, count: 0, total: 0 };
      b.count += 1; b.total += d.amount;
      map.set(key, b);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [toRefund, q, gov]);

  return (
    <div className="mt-5 space-y-6">
      {/* À préparer — ended lots whose cautions still need releasing */}
      {toPrepare.length > 0 && (
        <section>
          <h3 className="batta-eyebrow mb-2 flex items-center gap-2">
            <span aria-hidden className="batta-gold-rule-short" />
            Enchères terminées à préparer
            <span className="ml-1 rounded-full batta-tone-warn px-2 py-0.5 text-[10px] font-extrabold">{toPrepare.length}</span>
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {toPrepare.map((a) => (
              <Link
                key={a.auctionId}
                href={`/admin/auctions/${a.auctionId}`}
                className="group flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-gold-soft/60"
              >
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gold-faint text-gold">
                  <CircleDollarSign className="size-5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-foreground">{a.title}</div>
                  <div className="mt-0.5 text-[11px] text-muted">{a.lockedCount} caution{a.lockedCount > 1 ? "s" : ""} à libérer</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted transition group-hover:text-gold" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* À rembourser — one box per auction */}
      <section>
        <h3 className="batta-eyebrow mb-2 flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Cautions à rembourser
          {toRefund.length > 0 && (
            <span className="ml-1 rounded-full batta-tone-warn px-2 py-0.5 text-[10px] font-extrabold">{toRefund.length}</span>
          )}
        </h3>

        {toRefund.length === 0 ? (
          <Empty text="Rien à rembourser pour le moment." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" strokeWidth={2} />
                <input
                  type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bien ou acheteur…"
                  className="h-9 w-56 rounded-lg border border-border bg-surface pl-8 pr-3 text-[12px] text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
                />
              </div>
              {govs.length > 1 && (
                <select value={gov} onChange={(e) => setGov(e.target.value)} aria-label="Gouvernorat"
                  className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground focus:border-gold focus:outline-none">
                  <option value="all">Tous les gouvernorats</option>
                  {govs.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              )}
              {(q || gov !== "all") && (
                <button type="button" onClick={() => { setQ(""); setGov("all"); }} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold text-muted hover:bg-surface-2 hover:text-foreground">
                  <X className="size-3.5" /> Réinitialiser
                </button>
              )}
              <span className="batta-tabular ms-auto text-[12px] text-muted">{boxes.length} enchère{boxes.length > 1 ? "s" : ""}</span>
            </div>

            {boxes.length === 0 ? (
              <Empty text="Aucune caution ne correspond à ce filtre." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {boxes.map((b) => (
                  <Link
                    key={b.auctionId ?? b.title}
                    href={b.auctionId ? `/admin/auctions/${b.auctionId}` : "#"}
                    className="group flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-gold-soft/60 hover:shadow-[0_12px_30px_-14px_rgba(30,58,138,0.35)]"
                  >
                    <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gold-faint text-gold">
                      <Gavel className="size-5" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-foreground">{b.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                        {b.gov && <><MapPin className="size-3" /> {b.gov}<span aria-hidden className="opacity-40">·</span></>}
                        <span className="batta-tabular">{b.count} caution{b.count > 1 ? "s" : ""} · {fmt(b.total)}</span>
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted transition group-hover:text-gold" />
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Recent refunds — compact read-only */}
      {refunded.length > 0 && (
        <section>
          <h3 className="batta-eyebrow mb-2 flex items-center gap-2">
            <span aria-hidden className="batta-gold-rule-short" />
            Remboursements récents
          </h3>
          <ul className="space-y-1.5">
            {refunded.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-border">
                <div className="min-w-0 inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  <span className="truncate text-[12.5px] text-foreground">{d.bidder} · {d.title}</span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="batta-tabular text-[12.5px] font-bold text-foreground">{fmt(d.amount)}</div>
                  {d.refundRef && <div className="inline-flex items-center gap-1 text-[10px] text-muted"><FileText className="size-2.5" /> {d.refundRef}</div>}
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
  return <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted">{text}</div>;
}
