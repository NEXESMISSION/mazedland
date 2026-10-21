"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { cn } from "@/lib/utils";
import { FURNISHED, type DealType, type Furnished } from "@/lib/listings/deal";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { Bell, Check, KeyRound, Loader2, MapPin, Search, X } from "lucide-react";

/** The form holds strings, because inputs do; the API types them. */
export type RequestFormValue = {
  deal_type: DealType;
  category_ids: string[];
  governorates: string[];
  budget_min: string;
  budget_max: string;
  surface_min: string;
  rooms_min: string;
  furnished: Furnished | "";
  move_in_by: string;
  note: string;
  alerts: boolean;
};

const MAX_GOVERNORATES = 5;

/**
 * One demande, on one screen: short on purpose — a buyer should be able to
 * leave their criteria in under a minute. Only the ceiling is required; every
 * other answer narrows the alerts and can be left empty ("any").
 */
export function RequestForm({
  id,
  initial,
  categories,
  locale,
}: {
  id: string | null;
  initial: RequestFormValue;
  categories: { id: string; slug: string; label: string }[];
  locale: string;
}) {
  const t = useTranslations("requests");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [v, setV] = useState<RequestFormValue>(initial);
  const [busy, setBusy] = useState(false);
  const [budgetFlag, setBudgetFlag] = useState(false);
  const rent = v.deal_type === "rent";
  const set = <K extends keyof RequestFormValue>(k: K, value: RequestFormValue[K]) =>
    setV((s) => ({ ...s, [k]: value }));

  function toggleCategory(catId: string) {
    setV((s) => ({
      ...s,
      category_ids: s.category_ids.includes(catId)
        ? s.category_ids.filter((x) => x !== catId)
        : [...s.category_ids, catId],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(Number(v.budget_max) > 0)) {
      setBudgetFlag(true);
      document.getElementById("r-budget")?.focus();
      toast(t("budgetMissing"), "warning");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          deal_type: v.deal_type,
          category_ids: v.category_ids,
          governorates: v.governorates,
          budget_min: v.budget_min || null,
          budget_max: v.budget_max || null,
          surface_min: v.surface_min || null,
          rooms_min: v.rooms_min || null,
          furnished: rent && v.furnished ? v.furnished : null,
          move_in_by: rent && v.move_in_by ? v.move_in_by : null,
          note: v.note,
          alerts: v.alerts,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("saveFailed")), "error");
        return;
      }
      toast(t("saved"), "success");
      router.push("/account/requests" as never);
    } catch {
      toast(t("saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] text-foreground outline-none transition placeholder:text-muted focus:border-gold";
  const label = "text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted";
  const chip = (on: boolean) =>
    cn(
      "tap-target inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold transition",
      on ? "bg-gold-faint text-gold ring-1 ring-gold" : "bg-surface-2 text-muted ring-1 ring-border hover:text-foreground",
    );

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      {/* Buy or rent — it decides the budget's scale and the rental questions. */}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className={label}>{t("dealLabel")}</p>
        <div role="radiogroup" className="mt-2 grid grid-cols-2 gap-2">
          {(["sale", "rent"] as const).map((k) => {
            const on = v.deal_type === k;
            const Icon = k === "rent" ? KeyRound : Search;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() =>
                  setV((s) =>
                    s.deal_type === k
                      ? s
                      : // The budget belongs to the other scale; rental questions go with rent.
                        { ...s, deal_type: k, budget_min: "", budget_max: "", furnished: "", move_in_by: "" },
                  )
                }
                className={cn(
                  "tap-target flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-[14px] font-extrabold transition",
                  on ? "bg-gold-faint text-gold ring-2 ring-gold" : "bg-surface-2 text-muted ring-1 ring-border",
                )}
              >
                <Icon className="size-4" />
                {t(k === "rent" ? "dealRent" : "dealSale")}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <p className={label}>{t("categoriesLabel")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const on = v.category_ids.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => toggleCategory(c.id)} className={chip(on)}>
                {on && <Check className="size-3.5" />}
                {c.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">{t("categoriesAny")}</p>

        <p className={cn(label, "mt-4")}>{t("governoratesLabel")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {v.governorates.length === 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-bold text-muted ring-1 ring-border">
              <MapPin className="size-3.5" /> {t("governoratesAny")}
            </span>
          )}
          {v.governorates.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => set("governorates", v.governorates.filter((x) => x !== g))}
              aria-label={t("removeGovernorate", { name: governorateLabel(g, locale) })}
              className={chip(true)}
            >
              {governorateLabel(g, locale)} <X className="size-3.5" />
            </button>
          ))}
        </div>
        {v.governorates.length < MAX_GOVERNORATES && (
          <select
            value=""
            onChange={(e) => {
              const g = e.target.value;
              if (g && !v.governorates.includes(g)) set("governorates", [...v.governorates, g]);
            }}
            className={cn(field, "mt-2 appearance-none")}
          >
            <option value="">{t("governoratesAdd")}</option>
            {TUNISIAN_GOVERNORATES.filter((g) => !v.governorates.includes(g)).map((g) => (
              <option key={g} value={g}>{governorateLabel(g, locale)}</option>
            ))}
          </select>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {t(rent ? "budgetMaxRent" : "budgetMaxSale")} <span className="text-gold">*</span>
            <input
              id="r-budget"
              type="number"
              inputMode="numeric"
              min={0}
              value={v.budget_max}
              onChange={(e) => { set("budget_max", e.target.value); setBudgetFlag(false); }}
              placeholder={rent ? "800" : "200000"}
              className={cn(field, "mazed-tabular font-bold", budgetFlag && "outline outline-2 outline-offset-2 outline-danger")}
            />
          </label>
          <label className={label}>
            {t("budgetMin")}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={v.budget_min}
              onChange={(e) => set("budget_min", e.target.value)}
              placeholder="0"
              className={cn(field, "mazed-tabular")}
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">{t("budgetHint")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {t("surfaceMin")}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={v.surface_min}
              onChange={(e) => set("surface_min", e.target.value)}
              placeholder="100"
              className={cn(field, "mazed-tabular")}
            />
          </label>
          <label className={label}>
            {t("roomsMin")}
            <select value={v.rooms_min} onChange={(e) => set("rooms_min", e.target.value)} className={cn(field, "appearance-none")}>
              <option value="">{t("roomsAny")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{t("roomsAtLeast", { count: n })}</option>
              ))}
            </select>
          </label>

          {rent && (
            <>
              <label className={label}>
                {t("furnishedLabel")}
                <select
                  value={v.furnished}
                  onChange={(e) => set("furnished", e.target.value as Furnished | "")}
                  className={cn(field, "appearance-none")}
                >
                  <option value="">{t("roomsAny")}</option>
                  {FURNISHED.map((f) => (
                    <option key={f} value={f}>{t(`furnished.${f}`)}</option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t("moveInBy")}
                <input
                  type="date"
                  value={v.move_in_by}
                  onChange={(e) => set("move_in_by", e.target.value)}
                  className={field}
                />
              </label>
            </>
          )}
        </div>

        <label className={cn(label, "mt-4 block")}>
          {t("noteLabel")}
          <textarea
            value={v.note}
            onChange={(e) => set("note", e.target.value)}
            maxLength={500}
            rows={3}
            dir="auto"
            placeholder={t("notePlaceholder")}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] normal-case tracking-normal text-foreground outline-none placeholder:text-muted focus:border-gold"
          />
        </label>
      </section>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface p-4">
        <input
          type="checkbox"
          checked={v.alerts}
          onChange={(e) => set("alerts", e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]"
        />
        <span className="flex items-start gap-2 text-[13px] leading-relaxed text-foreground">
          <Bell className="mt-0.5 size-4 shrink-0 text-gold" />
          {t("alertsLabel")}
        </span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="mazed-btn-luxe tap-target inline-flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {id ? t("submitEdit") : t("submitNew")}
      </button>
    </form>
  );
}
