"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { CreditCard, Loader2 } from "lucide-react";

/**
 * Start payment again for an annonce stuck in « À payer » with no open payment.
 *
 * That is what a refused receipt or a cancelled payment leaves behind: the
 * payment row goes to `failed`, the annonce stays `pending_payment`, and
 * nothing in the UI could create the next payment — the seller was told to
 * « régler les frais » with no way to do it. /submit reuses an actionable
 * payment when there is one, so pressing this cannot charge twice.
 */
export function PaySubmitButton({
  listingId,
  block = false,
  label = "Payer",
}: {
  listingId: string;
  block?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch(`/api/annonces/${listingId}/submit`, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        paymentId?: string;
        detail?: string;
      };
      if (!res.ok) {
        toast(j.detail ?? "Paiement impossible pour le moment.", "error");
        return;
      }
      if (j.paymentId) {
        router.push(`/payment/checkout?payment=${j.paymentId}` as never);
        return;
      }
      // No payment needed (a credit, a free category, or a fee already paid).
      toast("Annonce envoyée à la vérification.", "success");
      router.refresh();
    } catch {
      toast("Erreur réseau.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      className={
        block
          ? "mazed-btn-luxe tap-target mt-2.5 flex w-full items-center justify-center gap-1.5 px-3 py-2.5 text-[12.5px]"
          : "mazed-btn-luxe tap-target inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
      }
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
      {label}
    </button>
  );
}
