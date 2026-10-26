"use client";

import { useTranslations } from "next-intl";
import { Scale } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { COMPARE_MAX } from "@/lib/compare";
import { useCompare } from "./compareStore";

/**
 * « Comparer »: adds this annonce to the comparison, or takes it out. On a
 * photo it is a round chip like the heart; on the page, a labelled pill.
 */
export function CompareToggle({ listingId, variant = "chip" }: { listingId: string; variant?: "chip" | "pill" }) {
  const t = useTranslations("compare");
  const { toast } = useToast();
  const { has, toggle } = useCompare();
  const on = has(listingId);

  const onClick = () => {
    if (!toggle(listingId)) toast(t("full", { max: COMPARE_MAX }), "warning");
  };

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={cn(
          "tap-target inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-bold transition",
          on ? "border-[var(--gold-soft)] bg-[var(--gold-faint)] text-foreground" : "border-border text-foreground hover:bg-surface-2",
        )}
      >
        <Scale className="size-4" strokeWidth={2.2} /> {t(on ? "added" : "add")}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={t(on ? "remove" : "add")}
      title={t(on ? "remove" : "add")}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full border backdrop-blur-md transition",
        on ? "border-[var(--gold-soft)] bg-[var(--gold-faint)] text-[var(--gold)]" : "border-white/20 bg-black/45 text-white hover:bg-black/65",
      )}
    >
      <Scale className="size-4" strokeWidth={2.2} />
    </button>
  );
}
