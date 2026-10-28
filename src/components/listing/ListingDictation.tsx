"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square } from "lucide-react";
import { useSetting } from "@/components/settings/SettingsProvider";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import {
  DICTATION_LANGS,
  asDictationLang,
  recognitionCtor,
  speechLang,
  transcriptOf,
  withDictation,
  type DictationLang,
  type Recognition,
} from "@/components/search/speech";

const noop = () => () => {};
const LANG_KEY = "mazed_dictation_lang";

function storedLang(): DictationLang | null {
  try {
    return asDictationLang(window.localStorage.getItem(LANG_KEY));
  } catch {
    return null;
  }
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
  const { toast } = useToast();
  // Known only in the browser: rendered after hydration, never on the server.
  const supported = useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
  const [lang, setLang] = useState<DictationLang>(
    () => (typeof window === "undefined" ? null : storedLang()) ?? (speechLang(locale) as DictationLang),
  );
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  // The box as it was when the seller started talking, and the latest setter.
  const before = useRef("");
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => () => rec.current?.abort(), []);

  if (!enabled || !supported) return null;

  const names: Record<DictationLang, string> = {
    "ar-TN": t("aiVoiceLangTn"),
    "fr-FR": t("aiVoiceLangFr"),
    "en-US": t("aiVoiceLangEn"),
  };

  function pick(l: DictationLang) {
    setLang(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* private window: the choice lasts for this page only */
    }
  }

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.maxAlternatives = 1;
    // A description takes more than one breath: keep listening until the
    // seller stops it (or the browser does, after a long silence).
    r.continuous = true;
    before.current = latest.current.value;
    r.onresult = (e) => {
      latest.current.onChange(withDictation(before.current, transcriptOf(e.results), maxLength));
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      toast(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? t("aiVoiceDenied")
          : e.error === "no-speech"
            ? t("aiVoiceNoSpeech")
            : e.error === "language-not-supported"
              ? t("aiVoiceLangUnsupported")
              : t("aiVoiceFailed"),
        "error",
      );
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      toast(t("aiVoiceFailed"), "error");
    }
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
      <div role="radiogroup" aria-label={t("aiVoiceLang")} className="inline-flex rounded-full bg-surface p-0.5 ring-1 ring-border">
        {DICTATION_LANGS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            disabled={listening}
            onClick={() => pick(l)}
            lang={l.slice(0, 2)}
            className={cn(
              "tap-target rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-60",
              lang === l ? "bg-[var(--gold)] text-[var(--background)]" : "text-muted hover:text-foreground",
            )}
          >
            {names[l]}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className={cn("w-full text-[11.5px] text-muted", !listening && "sr-only")}>
        {listening ? t("aiVoiceListening") : ""}
      </p>
    </div>
  );
}
