"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DatabaseBackup, FileArchive, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";

/**
 * The two halves of a backup, each downloaded in one tap:
 *
 *  - « Sauvegarde » (data): every table as one JSON file (POST /api/admin/backup);
 *  - « Fichiers »: every photo, receipt and document as one ZIP
 *    (POST /api/admin/backup/files) — Supabase's own backups keep where the
 *    files are, not the files.
 *
 * Both hold personal data (names, phone numbers, receipts): they are for a
 * full admin, and belong on a computer kept safe.
 */
export function BackupButton({ kind = "data" }: { kind?: "data" | "files" }) {
  const t = useTranslations("admin.backup");
  const { toast } = useToast();
  const apiError = useApiError();
  const [busy, setBusy] = useState(false);
  const files = kind === "files";

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(files ? "/api/admin/backup/files" : "/api/admin/backup", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        url?: string; tables?: number; rows?: number; files?: number; bytes?: number; megabytes?: number;
        error?: string; detail?: string;
      };
      if (j.error === "too_big") {
        toast(t("filesTooBig", { size: j.megabytes ?? 0 }), "error");
        return;
      }
      if (!res.ok || !j.url) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      toast(
        files
          ? t("filesReady", { files: j.files ?? 0, size: Math.max(1, Math.round((j.bytes ?? 0) / 1048576)) })
          : t("ready", { tables: j.tables ?? 0, rows: j.rows ?? 0, size: Math.max(1, Math.round((j.bytes ?? 0) / 1024)) }),
        "success",
      );
      // A signed link that answers with Content-Disposition: attachment.
      window.location.assign(j.url);
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const Icon = files ? FileArchive : DatabaseBackup;
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title={files ? t("filesHint") : t("hint")}
      className="mazed-btn-luxe tap-target inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-[12px] disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" strokeWidth={2.2} />}
      {busy ? (files ? t("filesWorking") : t("working")) : files ? t("filesLabel") : t("label")}
    </button>
  );
}
