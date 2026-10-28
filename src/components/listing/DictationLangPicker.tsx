"use client";

import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { DICTATION_LANGS, type DictationLang } from "@/components/search/speech";
import type { DictationProblem } from "./useDictation";

const PROBLEM_KEY: Record<DictationProblem, string> = {
  denied: "aiVoiceDenied",
  noSpeech: "aiVoiceNoSpeech",
  langUnsupported: "aiVoiceLangUnsupported",
  failed: "aiVoiceFailed",
};

/** A toast that says what went wrong with the microphone, in the page's language. */
export function useDictationProblem() {
  const t = useTranslations("publish");
  const { toast } = useToast();
  return (p: DictationProblem) => toast(t(PROBLEM_KEY[p]), "error");
}

/** Tunisian, French or English: the language the browser listens for. */
export function DictationLangPicker({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: DictationLang;
  onChange: (l: DictationLang) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("publish");
  const names: Record<DictationLang, string> = {
    "ar-TN": t("aiVoiceLangTn"),
    "fr-FR": t("aiVoiceLangFr"),
    "en-US": t("aiVoiceLangEn"),
  };
  return (
    <div role="radiogroup" aria-label={t("aiVoiceLang")} className={cn("inline-flex rounded-full bg-surface p-0.5 ring-1 ring-border", className)}>
      {DICTATION_LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          disabled={disabled}
          onClick={() => onChange(l)}
          lang={l.slice(0, 2)}
          className={cn(
            "tap-target rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-60",
            value === l ? "bg-[var(--gold)] text-[var(--background)]" : "text-muted hover:text-foreground",
          )}
        >
          {names[l]}
        </button>
      ))}
    </div>
  );
}
