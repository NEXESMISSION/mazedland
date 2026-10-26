"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";

/** Creates the placement's payment and goes to the usual checkout. */
export function BuyPromo({ listingId, product, label }: { listingId: string; product: string; label: string }) {
  const t = useTranslations("promo");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/annonces/${listingId}/promo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ product }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j.paymentId) {
            toast(apiError(j, t("failed")), res.status === 409 ? "warning" : "error");
            return;
          }
          router.push(`/payment/checkout?payment=${j.paymentId}` as never);
        } catch {
          toast(t("failed"), "error");
        } finally {
          setBusy(false);
        }
      }}
      className="mazed-btn-luxe tap-target inline-flex h-10 items-center gap-1.5 px-4 text-[13px] disabled:opacity-60"
    >
      {busy && <Loader2 className="size-4 animate-spin" />} {label}
    </button>
  );
}
