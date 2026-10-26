"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { useSetting } from "@/components/settings/SettingsProvider";
import { Loader2 } from "lucide-react";

/**
 * Pause, resume, prolong (by `days`, the console's length of a demande) or
 * delete one demande. Delete asks first — it takes the matches with it — the
 * others are one tap and can be undone with the next one. With demandes
 * switched off, only pause and delete are left.
 */
export function RequestActions({ id, state, days }: { id: string; state: "active" | "paused" | "expired"; days: number }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const on = useSetting("feature_requests");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(action: "pause" | "resume" | "renew" | "delete") {
    if (action === "delete" && !window.confirm(t("deleteConfirm"))) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: action === "delete" ? undefined : JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("actionFailed")), "error");
        return;
      }
      toast(
        t(action === "delete" ? "deleted" : action === "pause" ? "paused" : action === "resume" ? "resumed" : "renewed", { days }),
        "success",
      );
      router.refresh();
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setBusy(null);
    }
  }

  const btn =
    "tap-target inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-bold text-muted ring-1 ring-border transition hover:text-foreground disabled:opacity-60";
  const spin = (a: string) => busy === a && <Loader2 className="size-3.5 animate-spin" />;

  return (
    <>
      {state === "active" && (
        <button type="button" disabled={!!busy} onClick={() => run("pause")} className={btn}>
          {spin("pause")} {t("pause")}
        </button>
      )}
      {on && state === "paused" && (
        <button type="button" disabled={!!busy} onClick={() => run("resume")} className={btn}>
          {spin("resume")} {t("resume")}
        </button>
      )}
      {on && (
        <button type="button" disabled={!!busy} onClick={() => run("renew")} className={btn}>
          {spin("renew")} {t("renew", { days })}
        </button>
      )}
      <button
        type="button"
        disabled={!!busy}
        onClick={() => run("delete")}
        className={`${btn} hover:text-[var(--danger)]`}
      >
        {spin("delete")} {t("delete")}
      </button>
    </>
  );
}
