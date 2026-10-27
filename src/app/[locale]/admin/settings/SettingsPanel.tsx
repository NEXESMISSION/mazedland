"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { checkSetting, rangeOf, type SettingDef } from "@/lib/settings/define";
import { SETTINGS, type SettingKey } from "@/lib/settings/registry";
import { ArrowUpRight, Check, Loader2, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";

/** What the form edits: the text in each field, the way it was typed. */
type Draft = Record<string, string | boolean>;

function toDraft(def: SettingDef, value: unknown): string | boolean {
  if (def.type === "bool") return value === true;
  if (def.type === "list") return Array.isArray(value) ? value.join("\n") : "";
  if (value === null || value === undefined) return "";
  return String(value);
}

function defaultDraft(def: SettingDef): string | boolean {
  return toDraft(def, def.type === "list" ? [...def.default] : def.default);
}

/**
 * One tab of /admin/settings: every setting of a group, with its default and
 * its range, saved together. Only what changed is sent; « Rétablir » sends
 * `null`, which puts the default back (the stored row goes away).
 */
export function SettingsPanel({
  keys,
  values,
  stored,
}: {
  keys: SettingKey[];
  values: Record<string, unknown>;
  /** Keys with a stored row; the others show their default. */
  stored: string[];
}) {
  const t = useTranslations("settingsRegistry");
  const apiError = useApiError();
  const router = useRouter();
  const { toast } = useToast();
  const initial = useMemo(
    () => Object.fromEntries(keys.map((k) => [k, toDraft(SETTINGS[k], values[k])])) as Draft,
    [keys, values],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [reset, setReset] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const changed = keys.filter((k) => draft[k] !== initial[k] || reset.has(k));

  function set(key: SettingKey, v: string | boolean) {
    setDraft((d) => ({ ...d, [key]: v }));
    setReset((r) => {
      if (!r.has(key)) return r;
      const n = new Set(r);
      n.delete(key);
      return n;
    });
    setErrors((e) => (key in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));
    setSaved(false);
  }

  function backToDefault(key: SettingKey) {
    setDraft((d) => ({ ...d, [key]: defaultDraft(SETTINGS[key]) }));
    setReset((r) => new Set(r).add(key));
    setSaved(false);
  }

  function errorText(def: SettingDef, code: string): string {
    return t(`errors.${code}` as "errors.invalid_number", rangeOf(def));
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    const found: Record<string, string> = {};
    for (const key of changed) {
      const def = SETTINGS[key] as SettingDef;
      if (reset.has(key)) {
        body[key] = null;
        continue;
      }
      const checked = checkSetting(def, draft[key]);
      if (!checked.ok) found[key] = errorText(def, checked.error);
      else body[key] = checked.value;
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      toast(t("ui.fixErrors"), "error");
      return;
    }
    if (Object.keys(body).length === 0) return;
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { key?: string; detail?: string };
      if (!res.ok) {
        if (j.key && j.detail) setErrors({ [j.key]: j.detail });
        toast(apiError(j, t("ui.saveFailed")), "error");
        return;
      }
      setSaved(true);
      setReset(new Set());
      toast(t("ui.saved"), "success");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSave} className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
        {keys.map((key) => {
          const def = SETTINGS[key] as SettingDef;
          const isStored = stored.includes(key) && !reset.has(key);
          const isDefault = draft[key] === defaultDraft(def);
          return (
            <li key={key} className="px-4 py-3.5">
              <Field
                id={key}
                def={def}
                label={t(`${key}.label` as "feature_visits.label")}
                hint={t(`${key}.hint` as "feature_visits.hint")}
                value={draft[key]}
                onChange={(v) => set(key, v)}
                unit={"unit" in def && def.unit ? t(`units.${def.unit}` as "units.days") : ""}
                defaultLabel={defaultLabel(def, t)}
                error={errors[key]}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                {def.href && (
                  <Link href={def.href as "/admin"} className="inline-flex items-center gap-0.5 font-bold text-[var(--gold)] hover:underline">
                    {t("ui.manage")} <ArrowUpRight className="size-3 rtl:-scale-x-100" />
                  </Link>
                )}
                {isStored && !isDefault && (
                  <button type="button" onClick={() => backToDefault(key)} className="inline-flex items-center gap-1 font-semibold text-[var(--foreground-muted)] hover:text-foreground">
                    <RotateCcw className="size-3" /> {t("ui.reset")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-3 z-10">
        <button
          type="submit"
          disabled={isPending || changed.length === 0}
          className="mazed-btn-luxe tap-target inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px] disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved && changed.length === 0 ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : (
            <Save className="size-4" strokeWidth={2.5} />
          )}
          {isPending
            ? t("ui.saving")
            : changed.length > 0
              ? t("ui.saveCount", { count: changed.length })
              : saved
                ? t("ui.savedButton")
                : t("ui.save")}
        </button>
      </div>
    </form>
  );
}

function defaultLabel(def: SettingDef, t: ReturnType<typeof useTranslations<"settingsRegistry">>): string {
  if (def.type === "bool") return def.default ? t("ui.defaultOn") : t("ui.defaultOff");
  if (def.type === "list") return def.default.length ? t("ui.default", { value: def.default.join(", ") }) : t("ui.defaultEmpty");
  if (def.default === null || def.default === "") return t("ui.defaultEmpty");
  // Isolated: « 2026-10 » or « +216 … » reads backwards in an Arabic line otherwise.
  return t("ui.default", { value: `\u2066${def.default}\u2069` });
}

function Field({
  id, def, label, hint, value, onChange, unit, defaultLabel, error,
}: {
  id: string;
  def: SettingDef;
  label: string;
  hint: string;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
  unit: string;
  defaultLabel: string;
  error?: string;
}) {
  const t = useTranslations("settingsRegistry");
  if (def.type === "bool") {
    const on = value === true;
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-foreground">{label}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">{hint}</p>
          <p className="mt-0.5 text-[10.5px] text-subtle">{defaultLabel}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          onClick={() => onChange(!on)}
          className={cn(
            "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition",
            on ? "bg-[var(--tone-ok)]" : "bg-[var(--border-strong)]",
          )}
        >
          <span
            className={cn(
              "inline-block size-5 rounded-full bg-white shadow transition-transform",
              on ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5",
            )}
          />
          <span className="sr-only">{on ? t("ui.on") : t("ui.off")}</span>
        </button>
      </div>
    );
  }

  const inputId = `setting-${id}`;
  const ltr = def.type === "int" || def.type === "number" || (def.type === "text" && def.ltr);
  return (
    <div>
      <label htmlFor={inputId} className="text-[13px] font-bold text-foreground">{label}</label>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">{hint}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {(def.type === "int" || def.type === "number") && def.choices ? (
          <select
            id={inputId}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="mazed-input max-w-[14rem]"
          >
            {def.choices.map((c) => (
              <option key={c} value={String(c)}>
                {c === 0 ? t("ui.never") : unit ? `${c} ${unit}` : String(c)}
              </option>
            ))}
          </select>
        ) : def.type === "list" || (def.type === "text" && def.multiline) ? (
          <textarea
            id={inputId}
            rows={def.type === "list" ? 5 : 3}
            dir="auto"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="mazed-input resize-y py-2"
          />
        ) : (
          <input
            id={inputId}
            type={def.type === "text" ? "text" : "number"}
            inputMode={def.type === "int" ? "numeric" : def.type === "number" ? "decimal" : undefined}
            min={"min" in def ? def.min : undefined}
            max={def.type === "int" || def.type === "number" ? def.max : undefined}
            step={def.type === "number" ? (def.step ?? "any") : undefined}
            dir={ltr ? "ltr" : "auto"}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className={cn("mazed-input", def.type === "text" ? "" : "max-w-[9rem]")}
          />
        )}
        {unit && !("choices" in def && def.choices) && <span className="shrink-0 text-[12px] text-[var(--foreground-muted)]">{unit}</span>}
      </div>
      <p className="mt-1 text-[10.5px] text-subtle">
        {defaultLabel}
        {(def.type === "int" || def.type === "number") && !def.choices && <> · {t("ui.range", { min: def.min, max: def.max })}</>}
        {def.type === "list" && <> · {t("ui.listHint")}</>}
      </p>
      {error && <p role="alert" className="mt-1 text-[11.5px] font-semibold text-[var(--tone-bad)]">{error}</p>}
    </div>
  );
}
