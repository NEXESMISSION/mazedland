"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { useApiError } from "@/lib/useApiError";
import { BadgeCheck, EyeOff, RotateCw, Loader2 } from "lucide-react";

/**
 * « C'est vendu » and « Retirer » - the two things a seller wants from a live
 * annonce and had no way to do.
 *
 * Both ask first, because both take the annonce off the site, and both say
 * what happens to the money in the same breath: the days already paid for
 * keep running, and putting it back is free until they run out. Without that
 * sentence « Retirer » reads like burning the fee, so nobody presses it and a
 * sold property stays online taking calls.
 */

/** The copy for each act is `account.listingActions.<act>.{label,title,body,confirm,done}`. */
type Act = "mark_sold" | "withdraw" | "relist";

const ICON: Record<Act, typeof BadgeCheck> = {
  mark_sold: BadgeCheck,
  withdraw: EyeOff,
  relist: RotateCw,
};

export function ListingStatusActions({
  listingId,
  actions,
  block = false,
  primary = false,
}: {
  listingId: string;
  actions: Act[];
  /** Full-width, for the phone cards. */
  block?: boolean;
  /** Gold rather than quiet - for « Remettre en ligne », which is the point of the row. */
  primary?: boolean;
}) {
  const t = useTranslations("account.listingActions");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [asking, setAsking] = useState<Act | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(act: Act) {
    setBusy(true);
    try {
      const res = await fetch(`/api/annonces/${listingId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: act }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      toast(t(`${act}.done`), "success");
      setAsking(null);
      router.refresh();
    } catch {
      toast(t("networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  const quiet =
    "tap-target inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-bold text-muted transition hover:bg-surface-2 hover:text-foreground";
  const gold =
    "tap-target inline-flex items-center gap-1.5 rounded-full bg-gold-faint px-3 py-1.5 text-[12px] font-bold text-gold ring-1 ring-gold-soft transition hover:bg-gold-faint/70";

  return (
    <>
      <div className={block ? "mt-2 flex items-center gap-1.5" : "mt-1.5 flex items-center justify-end gap-1"}>
        {actions.map((act) => {
          const Icon = ICON[act];
          return (
            <button
              key={act}
              type="button"
              onClick={() => setAsking(act)}
              className={primary ? gold : quiet}
            >
              <Icon className="size-3.5" />
              {t(`${act}.label`)}
            </button>
          );
        })}
      </div>

      <Modal
        open={asking !== null}
        onClose={() => !busy && setAsking(null)}
        title={asking ? t(`${asking}.title`) : ""}
        description={asking ? t(`${asking}.body`) : ""}
        size="sm"
      >
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            disabled={busy}
            onClick={() => asking && run(asking)}
            className="mazed-btn-luxe tap-target flex flex-1 justify-center px-4 py-2.5 text-[13px] disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {asking ? t(`${asking}.confirm`) : ""}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAsking(null)}
            className="tap-target flex flex-1 justify-center rounded-xl border border-border px-4 py-2.5 text-[13px] font-bold text-muted transition hover:text-foreground disabled:opacity-60"
          >
            {t("cancel")}
          </button>
        </div>
      </Modal>
    </>
  );
}
