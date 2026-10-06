"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/**
 * Opt-out toggle for important-notification SMS. SMS is ON by default; flipping
 * this off persists `profiles.sms_notifications_enabled=false` via
 * /api/account/sms-pref. Optimistic with revert-on-error. Rendered inside the
 * auto settings page and the land account hub.
 */
export function SmsNotificationsToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("account.sms");
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const nextVal = !enabled;
    setEnabled(nextVal); // optimistic
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/sms-pref", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextVal }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (!res.ok || !j.ok) throw new Error("failed");
        toast(nextVal ? t("enabled") : t("disabled"), "success");
      } catch {
        setEnabled(!nextVal); // revert
        toast(t("failed"), "error");
      }
    });
  }

  return (
    <div className="flex items-center gap-3 p-4 lg:p-5">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/30">
        <MessageSquare className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold text-foreground">{t("title")}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted">
          {t("body")}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("ariaLabel")}
        disabled={pending}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          enabled ? "bg-[var(--gold)]" : "bg-surface-2 ring-1 ring-border"
        }`}
      >
        {/* The knob sits at the start of the track: on the right under RTL, so
            it has to travel the other way. */}
        <span
          className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-6 rtl:-translate-x-6" : "translate-x-1 rtl:-translate-x-1"
          }`}
        />
        {pending && (
          <Loader2 className="absolute inset-0 m-auto size-3 animate-spin text-foreground/60" />
        )}
      </button>
    </div>
  );
}
