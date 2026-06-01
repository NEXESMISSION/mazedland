"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useTransientDone } from "@/lib/useTransientDone";
import { formatTND } from "@/lib/utils";
import { resolveDeposit, type DepositConfig } from "@/lib/pricing";
import {
  Search, Loader2, Check, X, ShieldCheck, ShieldAlert, Gavel, User as UserIcon, Banknote,
} from "lucide-react";

type Kind = "deposit_lock" | "buy_now" | "final_payment";
type Method = "cash" | "cheque" | "transfer" | "other";

type UserOpt = { id: string; full_name: string | null; phone: string | null; kyc_status: string };
type AuctionOpt = {
  id: string; title: string; governorate: string | null; status: string;
  winner_user_id: string | null; buy_now_price: number | null;
  current_price: number | null; opening_price: number;
};

const KINDS: { value: Kind; label: string }[] = [
  { value: "deposit_lock", label: "Caution (entrée)" },
  { value: "buy_now", label: "Achat immédiat" },
  { value: "final_payment", label: "Paiement final" },
];
const METHODS: { value: Method; label: string }[] = [
  { value: "cash", label: "Espèces" },
  { value: "cheque", label: "Chèque" },
  { value: "transfer", label: "Virement reçu" },
  { value: "other", label: "Autre" },
];
const KYC_TONE: Record<string, string> = {
  verified: "batta-tone-ok",
  submitted: "batta-tone-warn",
  pending: "batta-tone-warn",
  rejected: "batta-tone-bad",
  none: "bg-surface-2 text-muted ring-1 ring-border",
};

export function ManualPaymentForm({ deposit }: { deposit: DepositConfig }) {
  const router = useRouter();
  const { toast } = useToast();

  const [kind, setKind] = useState<Kind>("deposit_lock");
  const [method, setMethod] = useState<Method>("cash");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, flashDone] = useTransientDone();

  const [selUser, setSelUser] = useState<UserOpt | null>(null);
  const [selAuction, setSelAuction] = useState<AuctionOpt | null>(null);

  // Suggested amount from the selected auction + kind (until the admin edits it).
  const suggested = (() => {
    if (!selAuction) return null;
    if (kind === "deposit_lock") {
      const r = resolveDeposit(deposit, selAuction.opening_price);
      return r.required ? r.amount : 0;
    }
    if (kind === "buy_now") return selAuction.buy_now_price ?? null;
    return selAuction.current_price ?? selAuction.opening_price;
  })();

  useEffect(() => {
    if (!amountTouched && suggested != null) setAmount(String(suggested));
  }, [suggested, amountTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!selUser || !selAuction) { toast("Choisissez un utilisateur et une enchère.", "error"); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast("Montant invalide.", "error"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/manual-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, userId: selUser.id, auctionId: selAuction.id, amount: amt, method, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast(j.detail ?? j.error ?? "Échec de l'enregistrement.", "error"); return; }
      if (j.kycWarning) {
        toast("Paiement enregistré. ⚠ L'utilisateur doit être vérifié (KYC) pour pouvoir enchérir.", "warning");
      } else {
        toast("Paiement enregistré.", "success");
      }
      flashDone();
      // Reset for the next entry.
      setSelUser(null); setSelAuction(null); setNote(""); setAmount(""); setAmountTouched(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Kind */}
      <Field label="Type de paiement">
        <div className="inline-flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => { setKind(k.value); setAmountTouched(false); }}
              className={`inline-flex h-9 items-center rounded-full border px-3.5 text-[12.5px] font-bold transition-colors ${
                kind === k.value
                  ? "border-[var(--gold)] bg-[var(--gold)] text-white"
                  : "border-border bg-surface text-muted hover:border-gold-soft"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </Field>

      {/* User */}
      <Field label="Utilisateur">
        {selUser ? (
          <Selected onClear={() => setSelUser(null)}>
            <span className="batta-monogram size-8 shrink-0 not-italic text-[11px] font-extrabold">
              {(selUser.full_name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-foreground">{selUser.full_name ?? "—"}</div>
              <div className="text-[11px] text-muted">{selUser.phone ?? "—"}</div>
            </div>
            <span className={`ms-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.12em] ${KYC_TONE[selUser.kyc_status] ?? KYC_TONE.none}`}>
              {selUser.kyc_status === "verified" ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
              {selUser.kyc_status === "verified" ? "KYC OK" : "KYC non vérifié"}
            </span>
          </Selected>
        ) : (
          <Combobox<UserOpt>
            type="user"
            placeholder="Nom ou téléphone…"
            icon={<UserIcon className="size-4" />}
            onPick={setSelUser}
            render={(u) => (
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-foreground">{u.full_name ?? "—"}</span>
                <span className="text-[11px] text-muted">{u.phone ?? ""}</span>
                <span className={`ms-auto rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.1em] ${KYC_TONE[u.kyc_status] ?? KYC_TONE.none}`}>
                  {u.kyc_status === "verified" ? "KYC" : "—"}
                </span>
              </div>
            )}
          />
        )}
        {selUser && kind === "deposit_lock" && selUser.kyc_status !== "verified" && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-700 ring-1 ring-amber-200">
            <ShieldAlert className="size-3.5" />
            Le paiement sera enregistré, mais l&apos;utilisateur doit être vérifié (KYC) pour enchérir.
          </p>
        )}
      </Field>

      {/* Auction */}
      <Field label="Enchère">
        {selAuction ? (
          <Selected onClear={() => setSelAuction(null)}>
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold-faint text-gold">
              <Gavel className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-foreground">{selAuction.title}</div>
              <div className="text-[11px] text-muted">{selAuction.governorate ?? ""} · {selAuction.status}</div>
            </div>
          </Selected>
        ) : (
          <Combobox<AuctionOpt>
            type="auction"
            placeholder="Titre du bien…"
            icon={<Gavel className="size-4" />}
            disabledItem={(a) => kind === "buy_now" && a.buy_now_price == null}
            onPick={setSelAuction}
            render={(a) => (
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-foreground">{a.title}</span>
                <span className="ms-auto shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted">{a.status}</span>
              </div>
            )}
          />
        )}
      </Field>

      {/* Amount */}
      <Field label="Montant (TND)">
        <div className="flex items-stretch overflow-hidden rounded-xl border border-border bg-surface focus-within:border-gold">
          <input
            type="number" step="0.01" min={0} inputMode="decimal"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setAmountTouched(true); }}
            placeholder="0.00"
            className="batta-tabular flex-1 bg-transparent px-3.5 py-2.5 text-[14px] text-foreground focus:outline-none"
          />
          <span className="inline-flex items-center px-3 text-[11px] font-bold text-muted">TND</span>
        </div>
        {suggested != null && !amountTouched && (
          <p className="mt-1 text-[11px] text-muted">
            Suggestion : {formatTND(suggested, "fr")} TND
            {kind === "deposit_lock" && suggested === 0 ? " (caution gratuite)" : ""}
          </p>
        )}
      </Field>

      {/* Method */}
      <Field label="Méthode">
        <div className="inline-flex flex-wrap gap-1.5">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMethod(m.value)}
              className={`inline-flex h-8 items-center rounded-full px-3 text-[12px] font-bold transition-colors ${
                method === m.value ? "bg-gold-faint text-gold ring-1 ring-gold/30" : "text-muted hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Note */}
      <Field label="Référence / note (optionnel)">
        <input
          type="text" value={note} maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex. reçu n°123, remis en main propre…"
          className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[13px] text-foreground placeholder:text-muted focus:border-gold focus:outline-none"
        />
      </Field>

      <button
        type="submit"
        disabled={submitting || !selUser || !selAuction}
        title={!selUser || !selAuction ? "Choisissez un utilisateur et une enchère" : undefined}
        className={`inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px] disabled:opacity-50 ${
          done
            ? "rounded-[var(--radius)] bg-[var(--success)] font-bold text-white"
            : "batta-btn-luxe"
        }`}
      >
        {done ? (
          <><Check className="size-4" strokeWidth={2.6} /> Paiement enregistré</>
        ) : submitting ? (
          <><Loader2 className="size-4 animate-spin" /> Enregistrement…</>
        ) : (
          <><Banknote className="size-4" strokeWidth={2.2} /> Enregistrer le paiement</>
        )}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="batta-eyebrow">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Selected({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-gold/30">
      {children}
      <button type="button" onClick={onClear} className="ms-1 shrink-0 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Changer">
        <X className="size-4" />
      </button>
    </div>
  );
}

function Combobox<T extends { id: string }>({
  type, placeholder, icon, onPick, render, disabledItem,
}: {
  type: "user" | "auction";
  placeholder: string;
  icon: React.ReactNode;
  onPick: (item: T) => void;
  render: (item: T) => React.ReactNode;
  disabledItem?: (item: T) => boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Only search once the admin has actually typed something. The old
  // version fetched on mount with an empty query and force-opened the
  // panel — so a list of "recent" rows popped up on its own before any
  // input. Empty query → no request, closed panel.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/manual-payment/options?type=${type}&q=${encodeURIComponent(query)}`);
        const j = await res.json().catch(() => ({}));
        setResults((j.results ?? []) as T[]);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, type]);

  // Click outside → close the panel (it used to stay open until a pick).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-gold">
        <span className="text-muted">{icon}</span>
        <input
          type="text" value={q} onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className="flex-1 bg-transparent py-2.5 text-[13px] text-foreground placeholder:text-muted focus:outline-none"
        />
        {loading ? <Loader2 className="size-4 animate-spin text-muted" /> : <Search className="size-4 text-muted" />}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl bg-surface p-1 shadow-[0_18px_45px_-18px_rgba(0,0,0,0.45)] ring-1 ring-border">
          {results.map((item) => {
            const disabled = disabledItem?.(item) ?? false;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => { onPick(item); setOpen(false); setQ(""); }}
                  className="w-full rounded-lg px-2.5 py-2 text-start text-[13px] transition hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {render(item)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
