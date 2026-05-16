"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface Props {
  id: string;
  status: "requested" | "processing" | "paid" | "rejected";
}

/**
 * Per-row action set for the admin payout queue. Three transitions
 * depending on current status:
 *   - requested  → processing (acknowledged) or rejected (with reason)
 *   - processing → paid (transfer done)
 *   - paid/rejected → read-only (no actions surface)
 */
export function PayoutRowActions({ id, status }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function update(
    next: "processing" | "paid" | "rejected",
    notes?: string,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, notes: notes ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(`Erreur : ${data.error ?? res.status}`, "error");
        return;
      }
      const verb =
        next === "processing"
          ? "Marqué en traitement"
          : next === "paid"
            ? "Marqué payé"
            : "Refusé";
      toast(verb, next === "rejected" ? "warning" : "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function reject() {
    const reason = window.prompt(
      "Motif du refus (visible par le vendeur)",
      "IBAN invalide — veuillez soumettre un IBAN tunisien valide.",
    );
    if (reason === null) return;
    update("rejected", reason.trim().slice(0, 500) || undefined);
  }

  if (status === "paid" || status === "rejected") {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "requested" && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update("processing")}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            En traitement
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={reject}
            disabled={busy}
          >
            <X className="size-3.5" />
            Refuser
          </Button>
        </>
      )}
      {status === "processing" && (
        <Button
          size="sm"
          onClick={() => update("paid")}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Marquer payé
        </Button>
      )}
    </div>
  );
}
