"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { recognitionCtor, transcriptOf, type Recognition } from "@/components/search/speech";

const noop = () => () => {};

export type DictationProblem = "denied" | "noSpeech" | "langUnsupported" | "failed";

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

/**
 * The browser listening, for as long as the seller talks: `onText` gets
 * everything heard so far as it comes, `onEnd` the whole of it once the
 * browser stops (the seller pressed stop, or fell silent for a while).
 * `supported` is known only in the browser and is false on the server.
 */
export function useDictation(onProblem: (p: DictationProblem) => void) {
  const supported = useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.abort(), []);

  function start(lang: string, on: { onText: (said: string) => void; onEnd?: (said: string) => void }) {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.maxAlternatives = 1;
    // A description takes more than one breath.
    r.continuous = true;
    let said = "";
    r.onresult = (e) => {
      said = transcriptOf(e.results);
      on.onText(said);
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      onProblem(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "denied"
          : e.error === "no-speech"
            ? "noSpeech"
            : e.error === "language-not-supported"
              ? "langUnsupported"
              : "failed",
      );
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      on.onEnd?.(said);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      onProblem("failed");
    }
  }

  function stop() {
    rec.current?.stop();
  }

  return { supported, listening, start, stop };
}
