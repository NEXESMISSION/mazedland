"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  asDictationLang,
  recognitionCtor,
  speechLang,
  transcriptOf,
  type DictationLang,
  type Recognition,
} from "@/components/search/speech";

const noop = () => () => {};
const LANG_KEY = "mazed_dictation_lang";

export type DictationProblem = "denied" | "noSpeech" | "langUnsupported" | "failed";

/**
 * The language a seller dictates in: the one they picked last time on this
 * browser, else the page's (Tunisian Arabic on /ar, French otherwise).
 */
export function useDictationLang(locale: string): [DictationLang, (l: DictationLang) => void] {
  const [lang, setLang] = useState<DictationLang>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = asDictationLang(window.localStorage.getItem(LANG_KEY));
        if (stored) return stored;
      } catch {
        /* storage blocked: fall back to the page's language */
      }
    }
    return speechLang(locale) as DictationLang;
  });
  const pick = (l: DictationLang) => {
    setLang(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* private window: the choice lasts for this page only */
    }
  };
  return [lang, pick];
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

  function start(lang: DictationLang, on: { onText: (said: string) => void; onEnd?: (said: string) => void }) {
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
