"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";

/**
 * « Sauvegarde » — a copy of all the data, downloaded in one tap
 * (POST /api/admin/backup). The file holds everyone's names and phone
 * numbers: it is for a full admin, and it belongs on a computer kept safe.
 * Supabase Pro also keeps a daily backup of its own; this one is the copy in
 * hand, before a big change or at the end of the month.
 */
export function BackupButton() {
  const t = useTranslations("admin.backup");
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        url?: string; tables?: number; rows?: number; bytes?: number; error?: string; detail?: string;
      };
      if (!res.ok || !j.url) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      toast(t("ready", { tables: j.tables ?? 0, rows: j.rows ?? 0, size: Math.max(1, Math.round((j.bytes ?? 0) / 1024)) }), "success");
      // A signed link that answers with Content-Disposition: attachment.
      window.location.assign(j.url);
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title={t("hint")}
      className="mazed-btn-luxe tap-target inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-[12px] disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <DatabaseBackup className="size-4" strokeWidth={2.2} />}
      {busy ? t("working") : t("label")}
    </button>
  );
}
