"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { Loader2 } from "lucide-react";

/** Cancel the ask before it is posted, or take the posts down after. Asks first. */
export function WithdrawButton({ requestId, published }: { requestId: string; published: boolean }) {
  const t = useTranslations("promote");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!window.confirm(t(published ? "withdrawConfirm" : "cancelConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/social/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      toast(t(j.status === "cancelled" ? "cancelled" : "withdrawn"), "success");
      router.refresh();
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="tap-target inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-bold text-muted ring-1 ring-border transition hover:text-[var(--danger)] disabled:opacity-60"
    >
      {busy && <Loader2 className="size-3.5 animate-spin" />}
      {t(published ? "withdraw" : "cancel")}
    </button>
  );
}
