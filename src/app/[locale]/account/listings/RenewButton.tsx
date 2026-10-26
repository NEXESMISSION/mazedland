"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { RotateCw, Loader2 } from "lucide-react";

/**
 * Renew an expired annonce.
 *
 * The button says which way it will be covered before it is pressed — free
 * while the seller has a free place left, else a credit from their forfait —
 * because "Renouveler" that silently spends one of five prepaid publications is
 * the kind of surprise that turns into a support message. With neither, it
 * says the free places are full: there is no fee per annonce any more, and the
 * route answers with what to do instead (Mazed Immo Pro, or free a place).
 */
export function RenewButton({
  listingId,
  free = false,
  usesCredit,
}: {
  listingId: string;
  /** A free place is available (0165): the renewal costs nothing. */
  free?: boolean;
  usesCredit: boolean;
}) {
  const t = useTranslations("account.renew");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState(false);

  async function renew() {
    setBusy(true);
    try {
      const res = await fetch(`/api/annonces/${listingId}/renew`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // `j.error ?? …` printed bare codes (« not_renewable ») to the seller.
        toast(apiError(j, t("failed")), "error");
        return;
      }
      // `remaining` only exists when a forfait credit paid for it. Printing it
      // unconditionally announced « undefined publication(s) restante(s) » on
      // every free or paid renewal.
      const said =
        j.status === "published"
          ? t("donePublished")
          : typeof j.remaining === "number"
            ? t("doneWithCredits", { remaining: j.remaining })
            : t("done");
      // A free place paid for it: say how many are left.
      toast(
        typeof j.freeLeft === "number" ? `${said} ${t("freeLeft", { left: j.freeLeft })}` : said,
        "success",
      );
      router.refresh();
    } catch {
      toast(t("networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={renew}
      disabled={busy}
      className="tap-target mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold-faint px-3 py-1.5 text-[12px] font-bold text-gold ring-1 ring-gold-soft transition hover:bg-gold-faint/70 disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
      {t("button")}
      <span className="font-semibold opacity-80">
        · {free ? t("free") : usesCredit ? t("viaCredit") : t("full")}
      </span>
    </button>
  );
}
