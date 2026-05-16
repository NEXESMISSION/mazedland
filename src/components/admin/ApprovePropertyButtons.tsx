"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

export function ApprovePropertyButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function decide(decision: "ready" | "rejected") {
    let reason: string | null = null;
    if (decision === "rejected") {
      reason = window.prompt("Reason for rejection?") ?? null;
      if (!reason) return;
    }
    start(async () => {
      const res = await fetch(`/api/admin/properties/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision, rejection_reason: reason }),
      });
      if (!res.ok) {
        alert(`Failed: ${res.status}`);
        return;
      }
      router.refresh();
    });
  }

  if (status === "ready" || status === "rejected") {
    return <span className="text-xs text-white/40">—</span>;
  }
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("ready")}
        className="rounded-md bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("rejected")}
        className="rounded-md bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/30 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
