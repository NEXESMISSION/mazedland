"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square } from "lucide-react";
import { useSetting } from "@/components/settings/SettingsProvider";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { DICTATION_LANGS, withDictation, type DictationLang } from "@/components/search/speech";
import { useDictation, useDictationLang, type DictationProblem } from "./useDictation";

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

/**
 * Say the annonce instead of typing it, for the listing assistant's box: the
 * seller picks the language they speak (Tunisian, French or English), talks,
 * and the words are added to the box as they come. Nothing is sent to the
 * assistant until they press « Remplir pour moi », so they can read and fix
 * what was heard first. Hidden where the browser cannot listen (Firefox) and
 * when an admin switched it off (feature_ai_voice).
 */
export function ListingDictation({
  value,
  onChange,
  maxLength,
  disabled = false,
}: {
  value: string;
  onChange: (text: string) => void;
  maxLength: number;
  disabled?: boolean;
}) {
  const t = useTranslations("publish");
  const locale = useLocale();
  const enabled = useSetting("feature_ai_voice");
  const [lang, setLang] = useDictationLang(locale);
  const { supported, listening, start, stop } = useDictation(useDictationProblem());
  // The box as it was when the seller started talking, and the latest setter.
  const before = useRef("");
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  if (!enabled || !supported) return null;

  function toggle() {
    if (listening) return stop();
    before.current = latest.current.value;
    start(lang, {
      onText: (said) => latest.current.onChange(withDictation(before.current, said, maxLength)),
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={listening}
        className={cn(
          "tap-target inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold transition disabled:opacity-60",
          listening
            ? "bg-[var(--tone-bad)] text-white motion-safe:animate-pulse"
            : "bg-surface text-foreground ring-1 ring-gold-soft hover:ring-gold",
        )}
      >
        {listening ? <Square className="size-3.5" fill="currentColor" /> : <Mic className="size-4" />}
        {listening ? t("aiVoiceStop") : t("aiVoiceStart")}
      </button>
      <DictationLangPicker value={lang} onChange={setLang} disabled={listening} />
      <p role="status" aria-live="polite" className={cn("w-full text-[11.5px] text-muted", !listening && "sr-only")}>
        {listening ? t("aiVoiceListening") : ""}
      </p>
    </div>
  );
}
