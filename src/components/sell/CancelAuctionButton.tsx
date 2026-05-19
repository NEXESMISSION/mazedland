"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { Ban } from "lucide-react";

/**
 * Confirm-and-cancel button shown next to a seller's auction in the
 * dashboard. Only mounted by the parent when the auction is in a state
 * that COULD be cancelled (`scheduled` / `live` / `extending`). The
 * API enforces the bid-count gate — if a bid landed between page load
 * and click, the API replies 409:has_bids and the user gets a
 * "contact admin" toast.
 */
export function CancelAuctionButton({
  auctionId,
  propertyTitle,
}: {
  auctionId: string;
  propertyTitle: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function doCancel() {
    startTransition(async () => {
      const res = await fetch(`/api/auctions/${auctionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        const detail = (data as { detail?: string; error?: string }).detail
          ?? (data as { error?: string }).error
          ?? "Annulation impossible.";
        toast(detail, "error");
        setOpen(false);
        return;
      }
      toast("Enchère annulée.", "success");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap-target inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/5 py-2.5 text-[12px] font-semibold text-red-400 transition-colors hover:border-red-500/50 hover:text-red-300"
      >
        <Ban className="size-3.5" strokeWidth={2.2} />
        Annuler l&apos;enchère
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Annuler l'enchère ?"
        description="Cette action est irréversible. L'annonce repassera en « prête » et vous pourrez la reprogrammer plus tard."
        size="sm"
      >
        <div className="text-[13px] text-foreground/85">
          <p>
            Vous êtes sur le point d&apos;annuler l&apos;enchère pour{" "}
            <span className="font-bold">« {propertyTitle} »</span>.
          </p>
          <p className="mt-2 text-[12px] text-[var(--foreground-muted)]">
            Si une offre a déjà été placée pendant que vous étiez sur
            cette page, l&apos;annulation sera refusée — contactez
            l&apos;administration dans ce cas.
          </p>
        </div>
        <ModalFooter>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Revenir
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={doCancel}
            disabled={isPending}
          >
            {isPending ? "Annulation…" : "Confirmer l'annulation"}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
