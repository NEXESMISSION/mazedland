"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { Check, Loader2, Save } from "lucide-react";

/**
 * The two settings that decide how much of the site runs by itself (0165):
 * how many annonces an individual keeps online for free, and the words that
 * send an annonce to a human before it is published. Changing either takes
 * effect on the next submission — no deploy.
 */
export function ModerationSettingsForm({
  initial,
}: {
  initial: { freeLimit: number; bannedWords: string[] };
}) {
  const t = useTranslations("adminSettings.moderation");
  const apiError = useApiError();
  const router = useRouter();
  const { toast } = useToast();
  const [freeLimit, setFreeLimit] = useState(String(initial.freeLimit));
  const [words, setWords] = useState(initial.bannedWords.join("\n"));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const limit = Number(freeLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 50) {
      toast(t("limitInvalid"), "error");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          free_listing_limit: limit,
          moderation_banned_words: words.split(/[\n,]/).map((w) => w.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(apiError(j, t("saveFailed")), "error");
        return;
      }
      setSaved(true);
      toast(t("saved"), "success");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSave} className="space-y-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
      <div>
        <h3 className="text-[14px] font-bold text-foreground">{t("title")}</h3>
        <p className="mt-0.5 text-[11.5px] text-[var(--foreground-muted)]">{t("hint")}</p>
      </div>

      <label className="block">
        <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">{t("freeLimitLabel")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={50}
          dir="ltr"
          value={freeLimit}
          onChange={(e) => {
            setFreeLimit(e.target.value);
            setSaved(false);
          }}
          className="mazed-input mt-1 max-w-[8rem]"
        />
        <span className="mt-1 block text-[11px] text-[var(--foreground-muted)]">{t("freeLimitHint")}</span>
      </label>

      <label className="block">
        <span className="text-[11px] font-semibold text-[var(--foreground-muted)]">{t("bannedWordsLabel")}</span>
        <textarea
          rows={5}
          dir="auto"
          value={words}
          onChange={(e) => {
            setWords(e.target.value);
            setSaved(false);
          }}
          className="mazed-input mt-1 resize-y py-2"
        />
        <span className="mt-1 block text-[11px] text-[var(--foreground-muted)]">{t("bannedWordsHint")}</span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="mazed-btn-luxe tap-target inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : saved ? (
          <Check className="size-4" strokeWidth={2.5} />
        ) : (
          <Save className="size-4" strokeWidth={2.5} />
        )}
        {isPending ? t("saving") : saved ? t("savedButton") : t("save")}
      </button>
    </form>
  );
}
