"use client";

import { Link } from "@/i18n/navigation";
import { ChevronLeft, X, ShieldCheck } from "lucide-react";
import { Stepper } from "./Stepper";

const STEP_LABELS = ["CIN recto", "CIN verso", "Selfie", "Vérification"] as const;

interface Props {
  /** 0 = front, 1 = back, 2 = selfie, 3 = verify. -1 hides stepper (intro/status). */
  current: number;
  children: React.ReactNode;
  backHref?: string;
  /** Optional override for the shell title. */
  title?: string;
}

/**
 * KYC shell with two layouts kept in parallel:
 *   Mobile (<lg): app-style flow — back arrow + title + close button at
 *     the top, horizontal stepper, narrow body.
 *   Desktop (lg+): luxury card layout — top app bar, content card with
 *     bigger typography, side margin so the camera flow doesn't fill
 *     the whole desktop viewport.
 */
export function KYCShell({
  current,
  children,
  backHref = "/",
  title,
}: Props) {
  const resolvedTitle = title ?? "Vérification d'identité";
  const steps = STEP_LABELS.map((label) => ({ label }));
  const showStepper = current >= 0;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ============================================================
          MOBILE
          ============================================================ */}
      <div className="lg:hidden flex flex-col flex-1">
        <header className="flex items-center justify-between px-4 pt-4 pb-1">
          <Link
            href={backHref as `/${string}`}
            aria-label="Retour"
            className="h-12 w-12 rounded-full bg-[var(--surface)] border-2 border-[var(--gold-soft)] text-[var(--gold)] flex items-center justify-center shadow-[var(--shadow-md)] hover:bg-[var(--gold-faint)] hover:border-[var(--gold)] active:scale-95 transition-all"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
          </Link>
          <div className="font-bold text-sm">{resolvedTitle}</div>
          <Link
            href="/"
            aria-label="Annuler"
            className="h-10 w-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center hover:border-[var(--danger)]/40 hover:text-[var(--danger)] transition-colors"
          >
            <X className="h-4 w-4" />
          </Link>
        </header>

        {showStepper && (
          <div className="px-4 pb-3">
            <Stepper steps={steps} current={current} />
          </div>
        )}

        <main className="flex-1 px-4 py-2 max-w-[var(--max-w)] mx-auto w-full">
          {children}
        </main>
      </div>

      {/* ============================================================
          DESKTOP
          ============================================================ */}
      <div className="hidden lg:flex lg:flex-col lg:flex-1 lg:min-h-screen">
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-[var(--border)]">
          <div className="max-w-[var(--max-w-content)] mx-auto px-8 h-16 flex items-center gap-6">
            <Link
              href={backHref as `/${string}`}
              className="inline-flex items-center gap-2 h-10 ps-3 pe-4 rounded-full ring-1 ring-[var(--border)] hover:ring-[var(--gold)] hover:text-[var(--gold)] text-sm font-bold transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Retour
            </Link>
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] font-extrabold text-[var(--gold)]">
                <ShieldCheck className="h-3.5 w-3.5" />
                KYC
              </div>
              <div className="mt-0.5 text-base font-black truncate tracking-tight">
                {resolvedTitle}
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full ring-1 ring-[var(--border)] hover:ring-[var(--danger)]/50 hover:text-[var(--danger)] text-sm font-bold transition-colors"
            >
              <X className="h-4 w-4" />
              Annuler
            </Link>
          </div>
          {showStepper && (
            <div className="max-w-[var(--max-w-content)] mx-auto px-8 pb-4">
              <Stepper steps={steps} current={current} />
            </div>
          )}
        </header>

        <main className="flex-1 max-w-[var(--max-w-content)] mx-auto w-full px-8 py-10">
          <div className="rounded-[28px] bg-[var(--surface)] ring-1 ring-[var(--border)] p-10 xl:p-12 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
