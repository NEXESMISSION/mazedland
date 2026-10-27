"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { useApiError } from "@/lib/useApiError";
import { Loader2, Trash2 } from "lucide-react";

/**
 * « Supprimer » on a draft in « Mes annonces ». A draft was never online, so
 * deleting it loses nothing anyone else sees; it still asks first, since the
 * photos go with it.
 */
export function DeleteDraftButton({ listingId, block = false }: { listingId: string; block?: boolean }) {
  const t = useTranslations("account.listingActions.deleteDraft");
  const tActions = useTranslations("account.listingActions");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/annonces/${listingId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, tActions("failed")), "error");
        return;
      }
      toast(t("done"), "success");
      setAsking(false);
      router.refresh();
    } catch {
      toast(tActions("networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={
          block
            ? "tap-target mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold text-muted transition hover:text-[var(--tone-bad)]"
            : "tap-target inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11.5px] font-bold text-muted transition hover:bg-surface-2 hover:text-[var(--tone-bad)]"
        }
      >
        <Trash2 className="size-3.5" /> {t("label")}
      </button>

      <Modal open={asking} onClose={() => !busy && setAsking(false)} title={t("title")} description={t("body")} size="sm">
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--tone-bad)] px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("confirm")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAsking(false)}
            className="tap-target flex flex-1 justify-center rounded-xl border border-border px-4 py-2.5 text-[13px] font-bold text-muted transition hover:text-foreground disabled:opacity-60"
          >
            {tActions("cancel")}
          </button>
        </div>
      </Modal>
    </>
  );
}
