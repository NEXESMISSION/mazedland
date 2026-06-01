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
  // Intro (start) + terminal (status) screens hide the back/cancel chrome —
  // there's nowhere meaningful to go "back" to from the first screen, and a
  // bare X on the welcome screen reads as a dead-end.
  const showNav = current >= 0;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── MOBILE header (<lg) ── */}
      <header className="lg:hidden flex items-center gap-3 px-4 pt-4 pb-2">
        {showNav ? (
          <Link
            href={backHref as `/${string}`}
            aria-label="Retour"
            className="h-9 w-9 shrink-0 rounded-full border border-[var(--border)] text-[var(--foreground-muted)] flex items-center justify-center hover:border-[var(--gold)] hover:text-[var(--gold)] active:scale-95 transition-all rtl:rotate-180"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        ) : (
          <span aria-hidden className="h-9 w-9 shrink-0" />
        )}
        <div className="flex-1 min-w-0 text-center text-[13px] font-bold tracking-tight truncate">
          {resolvedTitle}
        </div>
        {showNav ? (
          <Link
            href="/"
            aria-label="Annuler"
            className="h-9 w-9 shrink-0 rounded-full border border-[var(--border)] text-[var(--foreground-subtle)] flex items-center justify-center hover:border-[var(--danger)]/40 hover:text-[var(--danger)] transition-colors"
          >
            <X className="h-4 w-4" />
          </Link>
        ) : (
          <span aria-hidden className="h-9 w-9 shrink-0" />
        )}
      </header>
      {showStepper && (
        <div className="lg:hidden px-4 pb-3">
          <Stepper steps={steps} current={current} />
        </div>
      )}

      {/* ── DESKTOP header (lg+) ── */}
      <header className="hidden lg:block sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="max-w-[var(--max-w-content)] mx-auto px-8 h-16 flex items-center gap-6">
          {showNav && (
            <Link
              href={backHref as `/${string}`}
              className="inline-flex items-center gap-2 h-10 ps-3 pe-4 rounded-full ring-1 ring-[var(--border)] hover:ring-[var(--gold)] hover:text-[var(--gold)] text-sm font-bold transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Retour
            </Link>
          )}
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] font-extrabold text-[var(--gold)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              KYC
            </div>
            <div className="mt-0.5 text-base font-black truncate tracking-tight">
              {resolvedTitle}
            </div>
          </div>
          {showNav && (
            <Link
              href="/"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full ring-1 ring-[var(--border)] hover:ring-[var(--danger)]/50 hover:text-[var(--danger)] text-sm font-bold transition-colors"
            >
              <X className="h-4 w-4" />
              Annuler
            </Link>
          )}
        </div>
        {showStepper && (
          <div className="max-w-[var(--max-w-content)] mx-auto px-8 pb-4">
            <Stepper steps={steps} current={current} />
          </div>
        )}
      </header>

      {/* ── SHARED content — rendered ONCE. Previously the children were
          rendered in BOTH a mobile and a desktop subtree (one CSS-hidden);
          for the camera/liveness step that mounted two <video> streams and
          two upload pipelines, which double-showed the preview and stalled
          the submit. One tree, responsive styling, fixes both. ── */}
      <main className="flex-1 w-full mx-auto px-4 py-2 max-w-[var(--max-w)] lg:max-w-[var(--max-w-content)] lg:px-8 lg:py-10">
        <div className="lg:rounded-[28px] lg:bg-[var(--surface)] lg:ring-1 lg:ring-[var(--border)] lg:p-10 lg:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)] xl:p-12">
          {children}
        </div>
      </main>
    </div>
  );
}
