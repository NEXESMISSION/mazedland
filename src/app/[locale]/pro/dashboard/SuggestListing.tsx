"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";

/** Put one of the shop's annonces in front of a demande's author (who stays anonymous). */
export function SuggestListing({
  shopId,
  requestId,
  options,
}: {
  shopId: string;
  requestId: string;
  /** The shop's annonces for this demande, best first, already labelled. */
  options: { id: string; label: string }[];
}) {
  const t = useTranslations("pro.demandes");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [pick, setPick] = useState(options[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  if (options.length === 0) return <p className="text-[12px] text-muted">{t("noneToOffer")}</p>;

  async function send() {
    setBusy(true);
    try {
      const res = await fetch(`/api/pro/shops/${shopId}/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, listingId: pick }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), res.status === 409 || res.status === 429 ? "warning" : "error");
        return;
      }
      toast(t("sent"), "success");
      router.refresh();
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        aria-label={t("choose")}
        className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-surface px-2 text-[12.5px] text-foreground"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button type="button" disabled={busy || !pick} onClick={() => void send()} className="mazed-btn-luxe tap-target inline-flex h-9 items-center gap-1.5 px-3.5 text-[12.5px] disabled:opacity-60">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} {t("offer")}
      </button>
    </div>
  );
}
