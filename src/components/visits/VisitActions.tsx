"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import type { VisitSide, VisitSlot, VisitStatus } from "@/lib/visits";

/**
 * What one side of a visit can do now (0174). The seller's side picks one of
 * the buyer's half-days to confirm, may add a word (« 10 h, devant la
 * résidence »), declines, or later says it took place; the buyer can cancel.
 */
export function VisitActions({
  visitId,
  side,
  status,
  slots,
  slotLabels,
}: {
  visitId: string;
  side: VisitSide;
  status: VisitStatus;
  slots: VisitSlot[];
  /** The slots, already said in the reader's language. */
  slotLabels: string[];
}) {
  const t = useTranslations("visits.actions");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [note, setNote] = useState("");

  async function act(action: "confirm" | "decline" | "done" | "cancel", success: string) {
    if (action === "cancel" && !window.confirm(t(side === "buyer" ? "cancelConfirm" : "cancelSellerConfirm"))) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/visites/${visitId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, slot: action === "confirm" ? slots[pick] : undefined, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      toast(success, "success");
      router.refresh();
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(null);
    }
  }

  const spin = (a: string) => (busy === a ? <Loader2 className="size-3.5 animate-spin" /> : null);
  const btn = "tap-target inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-bold transition disabled:opacity-60";

  if (side === "buyer") {
    if (status !== "requested" && status !== "confirmed") return null;
    return (
      <button type="button" disabled={!!busy} onClick={() => act("cancel", t("cancelled"))} className={`${btn} border border-border text-foreground hover:bg-surface-2`}>
        {spin("cancel")} {t("cancel")}
      </button>
    );
  }

  if (status === "requested") {
    return (
      <div className="space-y-2">
        <fieldset className="space-y-1">
          <legend className="text-[12px] font-bold text-foreground">{t("pickSlot")}</legend>
          {slotLabels.map((label, i) => (
            <label key={i} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
              <input type="radio" name={`slot-${visitId}`} checked={pick === i} onChange={() => setPick(i)} className="accent-[var(--gold)]" />
              {label}
            </label>
          ))}
        </fieldset>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={400}
          placeholder={t("notePlaceholder")}
          aria-label={t("note")}
          className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[12.5px] text-foreground focus:border-gold-soft focus:outline-none"
          dir="auto"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => act("confirm", t("confirmed"))} className={`${btn} mazed-btn-luxe`}>
            {spin("confirm") ?? <Check className="size-3.5" />} {t("confirm")}
          </button>
          <button type="button" disabled={!!busy} onClick={() => act("decline", t("declined"))} className={`${btn} border border-border text-foreground hover:bg-surface-2`}>
            {spin("decline") ?? <X className="size-3.5" />} {t("decline")}
          </button>
        </div>
      </div>
    );
  }

  if (status === "confirmed") {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => act("done", t("doneToast"))} className={`${btn} mazed-btn-luxe`}>
          {spin("done") ?? <Check className="size-3.5" />} {t("done")}
        </button>
        <button type="button" disabled={!!busy} onClick={() => act("cancel", t("cancelled"))} className={`${btn} border border-border text-foreground hover:bg-surface-2`}>
          {spin("cancel")} {t("cancel")}
        </button>
      </div>
    );
  }
  return null;
}
