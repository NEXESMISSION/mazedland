"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { Loader2 } from "lucide-react";

/** Name and governorate — what a new annonce is pre-filled with. */
export function ProfileForm({ initialName, initialGovernorate }: { initialName: string; initialGovernorate: string }) {
  const t = useTranslations("accountSettings");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [name, setName] = useState(initialName);
  const [gov, setGov] = useState(initialGovernorate);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== initialName.trim() || gov !== initialGovernorate;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, governorate: gov || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("saveFailed")), "error");
        return;
      }
      toast(t("saved"), "success");
      router.refresh();
    } catch {
      toast(t("saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const label = "text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted";
  const field =
    "mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] text-foreground outline-none focus:border-gold";

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <label className={label}>
        {t("nameLabel")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          dir="auto"
          autoComplete="name"
          className={field}
        />
      </label>
      <label className={label}>
        {t("governorateLabel")}
        <select value={gov} onChange={(e) => setGov(e.target.value)} className={`${field} appearance-none`}>
          <option value="">{t("governorateNone")}</option>
          {TUNISIAN_GOVERNORATES.map((g) => (
            <option key={g} value={g}>{governorateLabel(g, locale)}</option>
          ))}
        </select>
      </label>
      <p className="text-[11.5px] text-muted sm:col-span-2">{t("profileHint")}</p>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="mazed-btn-luxe tap-target inline-flex h-11 items-center gap-2 px-5 text-[13px] disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("save")}
        </button>
      </div>
    </form>
  );
}
