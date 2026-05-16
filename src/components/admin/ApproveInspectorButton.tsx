"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

export function ApproveInspectorButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function approve() {
    start(async () => {
      const res = await fetch(`/api/admin/inspectors/${id}/approve`, { method: "POST" });
      if (!res.ok) { alert("Failed"); return; }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={approve}
      className="rounded-md bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
    >
      Approve
    </button>
  );
}
