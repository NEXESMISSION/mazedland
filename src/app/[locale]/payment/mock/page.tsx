"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shield, Loader2, CheckCircle2, XCircle } from "lucide-react";

type Phase = "idle" | "processing" | "capturing" | "redirecting" | "failed";

const PROVIDER_LABELS: Record<string, string> = {
  konnect: "Konnect",
  paymee: "Paymee",
  flouci: "Flouci",
  d17: "D17 · La Poste Tunisienne",
  manual: "Virement bancaire",
};

/**
 * Sandbox gateway simulation. Replaces a real Konnect/Paymee/Flouci/D17
 * hosted page in dev. The simulation:
 *
 *   1. Lands with ?provider=X&amount=Y&id=Z&success=URL
 *   2. Shows a realistic provider-branded checkout
 *   3. Auto-progresses through processing → captured → redirect
 *      (the user can also click "Pay now" to start immediately;
 *      the auto-advance fires 2s after mount so impatient devs
 *      don't wait)
 *   4. POSTs to /api/payments/mock-capture which flips the payment
 *      row to status='captured' and lets the DB triggers do the
 *      auction close / deposit materialization
 *   5. Redirects to the success URL the initiating endpoint set
 *
 * This is dev-only — production payments hit the real gateway and
 * the gateway's webhook flips the payment status. Same DB trigger
 * fires either way, so business logic is identical.
 */
export default function PaymentMock() {
  const sp = useSearchParams();
  const provider = sp.get("provider") ?? "konnect";
  const amount = sp.get("amount") ?? "—";
  const id = sp.get("id") ?? "";
  const success = sp.get("success") ?? "/";

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Prevent double-fire if the user clicks AND auto-advance fires.
  const startedRef = useRef(false);

  async function start() {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("processing");
    setErrorMsg(null);

    // Simulated gateway latency — 1.4s. Realistic enough to feel like
    // a real gateway redirect without making the dev cycle painful.
    await new Promise((r) => setTimeout(r, 1400));

    setPhase("capturing");
    try {
      const res = await fetch("/api/payments/mock-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.detail ?? data.error ?? "Erreur de capture.");
        setPhase("failed");
        startedRef.current = false;
        return;
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Erreur réseau.");
      setPhase("failed");
      startedRef.current = false;
      return;
    }

    setPhase("redirecting");
    // Tiny pause so the user reads the "Paiement confirmé" tick
    // before being whisked away.
    setTimeout(() => {
      window.location.href = success;
    }, 800);
  }

  // Auto-advance after a brief moment so the dev doesn't have to click
  // every time. Cancellable by clicking the button explicitly.
  useEffect(() => {
    if (phase !== "idle") return;
    const t = setTimeout(start, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retry() {
    startedRef.current = false;
    setErrorMsg(null);
    setPhase("idle");
  }

  const providerLabel = PROVIDER_LABELS[provider] ?? provider.toUpperCase();
  const buttonLabel =
    phase === "processing"
      ? "Connexion à la banque…"
      : phase === "capturing"
        ? "Confirmation du paiement…"
        : phase === "redirecting"
          ? "Paiement confirmé"
          : `Payer ${amount} TND`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        {/* Provider-branded header band — mimics a real gateway page. */}
        <header className="bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface)] border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--gold)]">
                Passerelle de paiement
              </div>
              <div className="mt-0.5 text-base font-extrabold tracking-tight">
                {providerLabel}
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-[0.14em]">
              <Shield className="h-3 w-3" />
              Sandbox
            </span>
          </div>
        </header>

        {/* Amount summary */}
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-[var(--foreground-muted)]">
            Montant à payer
          </div>
          <div className="batta-tabular gradient-gold-text mt-2 text-[42px] font-extrabold leading-none">
            {amount}{" "}
            <span className="text-[18px] font-bold uppercase tracking-[0.14em] text-[var(--gold)]/80">
              TND
            </span>
          </div>
          <div className="mt-2 text-[10px] font-mono text-[var(--foreground-subtle)]">
            Réf · {id.slice(0, 8)}…
          </div>
        </div>

        {/* Phase indicator */}
        <div className="px-6 pb-2">
          <PhaseRow
            done={phase !== "idle"}
            active={phase === "processing"}
            label="Connexion à la banque"
          />
          <PhaseRow
            done={phase === "redirecting"}
            active={phase === "capturing"}
            label="Confirmation du paiement"
          />
          <PhaseRow
            done={false}
            active={phase === "redirecting"}
            label="Retour à Batta"
            failed={phase === "failed"}
          />
        </div>

        {/* Action button — collapses to a small status pill once the
            flow is running, expands back to "Réessayer" on failure. */}
        <div className="px-6 pb-6 pt-2">
          {phase === "failed" ? (
            <>
              <div className="rounded-[var(--radius)] bg-red-500/10 ring-1 ring-red-500/30 p-3 text-[12px] text-red-300 inline-flex items-start gap-2 w-full">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg ?? "Le paiement a échoué."}</span>
              </div>
              <button
                type="button"
                onClick={retry}
                className="mt-3 w-full h-12 rounded-[var(--radius)] bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] text-black font-bold text-[14px] shadow-[var(--shadow-gold)] active:scale-[0.99] transition-all"
              >
                Réessayer
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={phase !== "idle"}
              className="w-full h-12 rounded-[var(--radius)] bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] text-black font-bold text-[14px] shadow-[var(--shadow-gold)] active:scale-[0.99] transition-all disabled:opacity-80 disabled:cursor-default inline-flex items-center justify-center gap-2"
            >
              {phase === "redirecting" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : phase !== "idle" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {buttonLabel}
            </button>
          )}
          <p className="mt-3 text-center text-[10px] text-[var(--foreground-subtle)] leading-relaxed">
            Sandbox local — aucun débit réel n&apos;est effectué.
            <br />
            En production, cette page est remplacée par {providerLabel}.
          </p>
        </div>
      </div>
    </div>
  );
}

function PhaseRow({
  done,
  active,
  failed,
  label,
}: {
  done: boolean;
  active: boolean;
  failed?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
          failed
            ? "bg-red-500/15 text-red-300 ring-1 ring-red-500/40"
            : done
              ? "bg-emerald-500 text-white"
              : active
                ? "bg-[var(--gold-faint)] ring-1 ring-[var(--gold)] text-[var(--gold)]"
                : "bg-[var(--surface-2)] text-[var(--foreground-subtle)] ring-1 ring-[var(--border)]"
        }`}
      >
        {failed ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : done ? (
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={3} />
        ) : active ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : null}
      </span>
      <span
        className={`text-[12.5px] ${
          done
            ? "text-foreground font-semibold"
            : active
              ? "text-[var(--gold)] font-semibold"
              : "text-[var(--foreground-muted)]"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
