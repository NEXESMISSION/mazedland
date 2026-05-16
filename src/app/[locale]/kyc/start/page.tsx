"use client";

import { Link } from "@/i18n/navigation";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { KYCShell } from "@/components/layout/KYCShell";
import { Button } from "@/components/ui/Button";

export default function KYCStartPage() {
  return (
    // current=-1 hides the stepper — this is the prep screen, before step 1
    <KYCShell current={-1} title="Vérification d'identité">
      <div className="flex flex-col items-center text-center gap-5">
        <div className="h-14 w-14 rounded-full bg-[var(--gold-faint)] flex items-center justify-center shadow-[var(--shadow-gold)]">
          <ShieldCheck className="h-6 w-6 text-[var(--gold)]" />
        </div>

        <div>
          <h1 className="text-xl font-extrabold">Vérifions votre identité</h1>
          <p className="text-sm text-[var(--foreground-muted)] mt-1.5">
            Préparez votre <span className="font-semibold text-foreground">CIN</span> (recto/verso) avec un bon éclairage.
          </p>
        </div>

        <ol className="w-full flex items-center justify-between gap-2 text-[11px]">
          <Step num={1} label="CIN recto" />
          <Divider />
          <Step num={2} label="CIN verso" />
          <Divider />
          <Step num={3} label="Selfie" />
          <Divider />
          <Step num={4} label="Vérif." highlight />
        </ol>

        <Link href="/kyc/id-front" className="block w-full">
          <Button size="xl" fullWidth>
            Commencer
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>

        <p className="text-[10px] text-[var(--foreground-subtle)] leading-relaxed">
          Données chiffrées conformément à la loi tunisienne n°2004-63. En continuant, vous acceptez le traitement KYC par Batta.
        </p>
      </div>
    </KYCShell>
  );
}

function Step({
  num,
  label,
  highlight,
}: {
  num: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <li className="flex flex-col items-center gap-1.5 shrink-0">
      <div
        className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums ${
          highlight
            ? "bg-[var(--gold)] text-black"
            : "bg-[var(--surface-2)] text-[var(--foreground-muted)] border border-[var(--border)]"
        }`}
      >
        {num}
      </div>
      <span
        className={
          highlight
            ? "font-semibold"
            : "text-[var(--foreground-muted)]"
        }
      >
        {label}
      </span>
    </li>
  );
}

function Divider() {
  return <div className="flex-1 h-px bg-[var(--border)] mt-[-14px]" />;
}
