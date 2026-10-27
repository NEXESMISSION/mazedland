"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, MicOff } from "lucide-react";
import { useSetting } from "@/components/settings/SettingsProvider";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

/** The browser's speech recognition, where it has one (Chrome, Edge, Safari). */
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

/** The language the browser listens for: the page's. Tunisian Arabic where it knows it. */
export function speechLang(locale: string): string {
  return locale === "ar" ? "ar-TN" : "fr-FR";
}

/**
 * « Parler » in a search box (cahier P5): the person says what they look for,
 * the words fill the box as they come, and the search runs when they stop —
 * the natural search then reads « appartement S+2 à Sfax moins de 300 000 »
 * like typed text. Hidden where the browser cannot listen (Firefox) and when
 * an admin switched it off (feature_voice_search).
 *
 * `onText` takes the words for a box React controls; without it the button
 * fills the `q` (or search) input of its form and submits the form.
 */
export function VoiceSearchButton({
  onText,
  className,
}: {
  /** interim: still listening; final: the person stopped — search with it. */
  onText?: (text: string, final: boolean) => void;
  className?: string;
}) {
  const t = useTranslations("voiceSearch");
  const locale = useLocale();
  const enabled = useSetting("feature_voice_search");
  const { toast } = useToast();
  // Known only in the browser: rendered after hydration, never on the server.
  const supported = useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => () => rec.current?.abort(), []);

  if (!enabled || !supported) return null;

  function fill(text: string, final: boolean) {
    if (onText) return onText(text, final);
    const form = btn.current?.closest("form");
    const input = form?.querySelector<HTMLInputElement>('input[name="q"], input[type="search"]');
    if (!form || !input) return;
    // The native setter, so a box React controls hears it too.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (final && text.trim()) requestAnimationFrame(() => form.requestSubmit());
  }

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    setProblem(null);
    const r = new Ctor();
    r.lang = speechLang(locale);
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = false;
    let said = "";
    let done = false;
    r.onresult = (e) => {
      said = Array.from(e.results).map((res) => res[0]?.transcript ?? "").join(" ").replace(/\s+/g, " ").trim();
      const final = Array.from(e.results).every((res) => res.isFinal);
      fill(said, false);
      if (final && said && !done) {
        done = true;
        fill(said, true);
      }
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      const message = e.error === "not-allowed" || e.error === "service-not-allowed" ? t("denied") : e.error === "no-speech" ? t("noSpeech") : t("failed");
      setProblem(message);
      // A phone shows no tooltip: say it where it is seen.
      toast(message, "error");
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      // Some browsers end without marking the last words final.
      if (!done && said) {
        done = true;
        fill(said, true);
      }
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setProblem(t("failed"));
      toast(t("failed"), "error");
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={start}
        aria-label={listening ? t("stop") : t("start")}
        aria-pressed={listening}
        title={problem ?? (listening ? t("listening") : t("start"))}
        className={cn(
          "tap-target inline-flex size-9 shrink-0 items-center justify-center rounded-full transition",
          listening ? "bg-[var(--tone-bad)] text-white motion-safe:animate-pulse" : "text-muted hover:bg-surface-2 hover:text-foreground",
          className,
        )}
      >
        {problem && !listening ? <MicOff className="size-4" strokeWidth={2} /> : <Mic className="size-4" strokeWidth={2} />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {listening ? t("listening") : problem ?? ""}
      </span>
    </>
  );
}
