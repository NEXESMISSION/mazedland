"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Check, X } from "lucide-react";
import { AdminButton } from "@/components/admin/AdminButton";

export function ReviewKycButtons({ submissionId, userId }: { submissionId: string; userId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();

  function decide(verdict: "verified" | "rejected") {
    const notes = verdict === "rejected" ? window.prompt("Motif du rejet (visible par l'utilisateur)") ?? "" : "";
    if (verdict === "rejected" && !notes.trim()) return;
    start(async () => {
      const res = await fetch(`/api/admin/kyc/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, notes, user_id: userId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.detail ?? j.error ?? `Échec de la décision (${res.status}).`, "error");
        return;
      }
      toast(verdict === "verified" ? "Identité vérifiée." : "Soumission rejetée.", verdict === "verified" ? "success" : "warning");
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex gap-2">
      <AdminButton
        variant="success"
        pending={pending}
        onClick={() => decide("verified")}
        icon={<Check className="size-3.5" strokeWidth={2.5} />}
      >
        Vérifier
      </AdminButton>
      <AdminButton
        variant="dangerSoft"
        pending={pending}
        onClick={() => decide("rejected")}
        icon={<X className="size-3.5" strokeWidth={2.5} />}
      >
        Rejeter
      </AdminButton>
    </div>
  );
}
