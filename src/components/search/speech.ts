/**
 * The browser's speech recognition, shared by the search boxes' microphone
 * and « Publier en parlant » (version B of the publish flow). Chrome, Edge and Safari have it
 * (Chrome sends the audio to Google to transcribe); Firefox does not, and
 * every caller hides its microphone there.
 */

export type Recognition = {
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

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The language the browser listens for: the page's. Tunisian Arabic where it knows it. */
export function speechLang(locale: string): string {
  return locale === "ar" ? "ar-TN" : "fr-FR";
}

/** Everything recognised so far, as one line. */
export function transcriptOf(results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  return Array.from(results)
    .map((r) => r[0]?.transcript ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
