"use client";

import { useTransition } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Check, X, Loader2, RotateCcw } from "lucide-react";

/**
 * Approve / reject controls for a pending property. Approve fires
 * inline (single decision, no extra context needed). Reject navigates
 * to a dedicated /admin/properties/<id>/reject page where the admin
 * can pick a preset reason, edit it, and send — much more room than the
 * old inline modal, and the URL is shareable so a second admin can
 * pick up where the first left off.
 */
export function ApprovePropertyButtons({
  id, status, acceptPaymentId, promoDurations,
}: {
  id: string;
  status: string;
  /** When a listing-fee receipt is awaiting validation, approving accepts
   *  THAT payment (capture + publish + promos) instead of a plain approve. */
  acceptPaymentId?: string;
  promoDurations?: Record<string, number>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();

  function approve() {
    start(async () => {
      const useReceipt = !!acceptPaymentId;
      const res = useReceipt
        ? await fetch(`/api/admin/payments/${acceptPaymentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verdict: "captured", durations: promoDurations ?? {} }),
          })
        : await fetch(`/api/admin/properties/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ready", rejection_reason: null }),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.detail ?? j.error ?? `Échec de l'action (${res.status}).`, "error");
        return;
      }
      toast("Annonce validée et publiée.", "success");
      router.refresh();
    });
  }

  // Undo a rejection — flip status back to pending_review and clear
  // the motif so the listing re-enters the queue cleanly. The
  // /api/admin/properties PATCH route accepts 'pending_review' so the
  // call shape mirrors approve/reject.
  function restore() {
    start(async () => {
      const res = await fetch(`/api/admin/properties/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending_review", rejection_reason: null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.detail ?? j.error ?? `Échec (${res.status}).`, "error");
        return;
      }
      toast("Refus annulé. Annonce remise en file d'attente.", "success");
      router.refresh();
    });
  }

  // "Ready" listings are already published and shouldn't be un-published
  // from this control — there are sell-flow cancel paths for that.
  // "Rejected" listings DO get an undo here, otherwise an accidental
  // refusal is permanent until the seller re-submits.
  if (status === "ready") {
    return <span className="text-xs text-muted">—</span>;
  }

  if (status === "rejected") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={restore}
        className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" strokeWidth={2.5} />}
        Restaurer
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={approve}
        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" strokeWidth={2.5} />}
        Approuver
      </button>
      <Link
        href={`/admin/properties/${id}/reject` as `/admin/properties/${string}`}
        className="inline-flex items-center gap-1 rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 ring-1 ring-red-200 transition hover:bg-red-100"
      >
        <X className="size-3.5" strokeWidth={2.5} />
        Rejeter
      </Link>
    </div>
  );
}
