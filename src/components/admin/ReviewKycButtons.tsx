"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

export function ReviewKycButtons({ submissionId, userId }: { submissionId: string; userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function decide(verdict: "verified" | "rejected") {
    const notes = verdict === "rejected" ? window.prompt("Reason?") ?? "" : "";
    if (verdict === "rejected" && !notes) return;
    start(async () => {
      const res = await fetch(`/api/admin/kyc/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, notes, user_id: userId }),
      });
      if (!res.ok) { alert("Failed"); return; }
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex gap-2">
      <button
        type="button" disabled={pending} onClick={() => decide("verified")}
        className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
      >
        Verify
      </button>
      <button
        type="button" disabled={pending} onClick={() => decide("rejected")}
        className="rounded-md bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/30 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
