"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Check } from "lucide-react";
import { AdminButton } from "@/components/admin/AdminButton";

export function ApproveInspectorButton({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();

  function approve() {
    start(async () => {
      const res = await fetch(`/api/admin/inspectors/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.detail ?? j.error ?? `Échec de l'approbation (${res.status}).`, "error");
        return;
      }
      toast("Inspecteur approuvé.", "success");
      router.refresh();
    });
  }

  return (
    <AdminButton
      variant="success"
      pending={pending}
      onClick={approve}
      icon={<Check className="size-3.5" strokeWidth={2.5} />}
    >
      Approuver
    </AdminButton>
  );
}
