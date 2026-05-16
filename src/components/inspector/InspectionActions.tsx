"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { Check, X, Play, Upload, Send } from "lucide-react";

/**
 * State-aware action row for an inspection card. The legal transitions
 * are enforced server-side by the `update_inspection_status` RPC; this
 * UI just exposes the right verb per state.
 *
 *   requested   → Accept / Decline
 *   scheduled   → Start visit / Decline
 *   in_progress → Upload PDF, then Submit report
 */
export function InspectionActions({
  inspectionId,
  status,
}: {
  inspectionId: string;
  status: string;
}) {
  const t = useTranslations("inspector.actions");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [reportName, setReportName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function transition(newStatus: "scheduled" | "cancelled" | "in_progress" | "submitted") {
    setError(null);
    start(async () => {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.rpc("update_inspection_status", {
        p_inspection_id: inspectionId,
        p_new_status: newStatus,
        p_report_path: newStatus === "submitted" ? reportPath : null,
      });
      if (error) {
        setError(error.message);
        return;
      }
      router.refresh();
    });
  }

  async function onPickReport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = getBrowserSupabase();
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      // Storage RLS expects path[1] = inspections.id, so we namespace
      // the upload by the inspection id, not by the user id.
      const path = `${inspectionId}/report-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("inspection-reports")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);
      setReportPath(path);
      setReportName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload_failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (status === "requested") {
    return (
      <div className="flex gap-2 border-t border-border p-2">
        <ActionButton onClick={() => transition("scheduled")} disabled={pending} tone="navy">
          <Check className="size-3.5" /> {t("accept")}
        </ActionButton>
        <ActionButton onClick={() => transition("cancelled")} disabled={pending} tone="muted">
          <X className="size-3.5" /> {t("decline")}
        </ActionButton>
        {error && <ErrorBubble error={error} />}
      </div>
    );
  }

  if (status === "scheduled") {
    return (
      <div className="flex gap-2 border-t border-border p-2">
        <ActionButton onClick={() => transition("in_progress")} disabled={pending} tone="navy">
          <Play className="size-3.5" /> {t("start")}
        </ActionButton>
        <ActionButton onClick={() => transition("cancelled")} disabled={pending} tone="muted">
          <X className="size-3.5" /> {t("decline")}
        </ActionButton>
        {error && <ErrorBubble error={error} />}
      </div>
    );
  }

  if (status === "in_progress") {
    return (
      <div className="border-t border-border p-2 space-y-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onPickReport}
        />
        {reportPath ? (
          <div className="rounded-lg bg-surface-2 p-2 text-[11px] text-foreground/85 ring-1 ring-gold/25">
            {t("uploaded", { name: reportName ?? "report.pdf" })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="tap-target flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gold/30 bg-surface-2 py-2.5 text-xs font-bold text-gold-bright disabled:opacity-50"
          >
            <Upload className="size-3.5" strokeWidth={2.2} />
            {uploading ? t("uploading") : t("uploadReport")}
          </button>
        )}
        <button
          type="button"
          onClick={() => transition("submitted")}
          disabled={pending || !reportPath}
          className="batta-btn-luxe tap-target w-full px-5 py-2.5 text-[12px] disabled:opacity-40"
        >
          <Send className="size-3.5" strokeWidth={2.2} />
          {t("submitReport")}
        </button>
        {error && <ErrorBubble error={error} />}
      </div>
    );
  }

  return null;
}

function ActionButton({
  children, onClick, disabled, tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "navy" | "muted";
}) {
  const cls = tone === "navy"
    ? "batta-gold-fill ring-1 ring-black/10 shadow-[var(--shadow-gold)]"
    : "border border-border bg-surface text-muted hover:border-gold/40";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`tap-target flex flex-1 items-center justify-center gap-1.5 rounded-full ${cls} py-2 text-xs font-bold disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

function ErrorBubble({ error }: { error: string }) {
  return (
    <p className="batta-tone-bad basis-full rounded-md px-2 py-1 text-[10px]">{error}</p>
  );
}
