"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Send } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { MAX_SUGGESTIONS_PER_REQUEST } from "@/lib/pro/suggest";

/** How many of the shop's annonces show before « Voir les autres ». */
const SHOWN = 3;

/**
 * Put one of the shop's annonces in front of a demande's author (who stays
 * anonymous).
 *
 * It was a select and a button: the best match went in one tap, any other in
 * three, behind a list of titles cut short. Now the shop's annonces for this
 * demande are listed, best first, each with its own « Proposer » — one tap,
 * whichever it is. The request is the same.
 */
export function SuggestListing({
  shopId,
  requestId,
  options,
  left,
}: {
  shopId: string;
  requestId: string;
  /** The shop's annonces for this demande, best first: `ok` when it meets every condition. */
  options: { id: string; title: string; score: number; ok: boolean }[];
  /** How many more the shop may still propose to this demande (MAX_SUGGESTIONS_PER_REQUEST in all). */
  left: number;
}) {
  const t = useTranslations("pro.demandes");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  if (left <= 0) return <p className="text-[12px] text-muted">{t("noneLeft", { max: MAX_SUGGESTIONS_PER_REQUEST })}</p>;
  if (options.length === 0) return <p className="text-[12px] text-muted">{t("noneToOffer")}</p>;

  async function send(listingId: string) {
    setBusy(listingId);
    try {
      const res = await fetch(`/api/pro/shops/${shopId}/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, listingId }),
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
      setBusy(null);
    }
  }

  const shown = all ? options : options.slice(0, SHOWN);
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-bold text-foreground">{t("choose")}</p>
      <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
        {shown.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="line-clamp-2 text-[13px] font-bold text-foreground" dir="auto">{o.title}</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-muted">
                {o.ok && <Check className="size-3.5 text-[var(--tone-ok)]" strokeWidth={3} />}
                {o.ok ? t("fullMatch", { score: o.score }) : t("partialMatch", { score: o.score })}
              </p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void send(o.id)}
              className="mazed-btn-luxe tap-target inline-flex h-10 shrink-0 items-center gap-1.5 px-4 text-[13px] disabled:opacity-60"
            >
              {busy === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5 rtl:-scale-x-100" />} {t("offer")}
            </button>
          </li>
        ))}
      </ul>
      {!all && options.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="tap-target text-[12.5px] font-bold text-gold hover:underline">
          {t("showAll", { count: options.length - SHOWN })}
        </button>
      )}
    </div>
  );
}
