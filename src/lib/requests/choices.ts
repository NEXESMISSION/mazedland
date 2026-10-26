/**
 * The ready answers of a demande (0168): what the form offers as chips so a
 * buyer taps their criteria instead of typing them. Each list keeps a way out
 * — « Autre » opens the field — and a value that came from elsewhere (a
 * search, an older demande) and is not a chip still shows as one, selected,
 * rather than being lost.
 *
 * Pure, so the lists and the choice logic are tested without a form.
 */
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";

/** Minimum surfaces, m². */
export const SURFACE_PRESETS: readonly number[] = [50, 80, 100, 150, 200];

/** Minimum S+ counts; the last one reads « S+5 ou plus ». */
export const ROOMS_PRESETS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * The governorates offered as chips: Grand Tunis, Cap Bon, the Sahel and Sfax,
 * where most annonces and most demandes are. One tap each; the other sixteen
 * stay in the list under them.
 */
export const QUICK_GOVERNORATES: readonly string[] = [
  "Tunis", "Ariana", "Ben Arous", "Manouba", "Nabeul", "Sousse", "Monastir", "Sfax",
];

/** Phrases « Autres souhaits » offers: `requests.notePhrases.<key>`. */
export const NOTE_PHRASES = ["seaView", "schools", "groundFloor", "parking", "furnished"] as const;

/** Which chip a number field is on: a preset, "other" for any other number, null when empty. */
export function presetChoice(value: string, presets: readonly number[]): number | "other" | null {
  const n = Number(value);
  if (!value.trim() || !(n > 0)) return null;
  return presets.includes(n) ? n : "other";
}

/**
 * The presets, plus the current value when it is not one of them — « S+7 »
 * from a search stays on screen, selected, instead of reading as « Peu importe ».
 */
export function withCurrent(presets: readonly number[], value: string): number[] {
  const n = Math.floor(Number(value));
  return n > 0 && !presets.includes(n) ? [...presets, n].sort((a, b) => a - b) : [...presets];
}

/** The governorate chips: the quick ones, then any other already chosen, in the canonical order. */
export function governorateChips(selected: readonly string[]): string[] {
  const extra = TUNISIAN_GOVERNORATES.filter((g) => selected.includes(g) && !QUICK_GOVERNORATES.includes(g));
  return [...QUICK_GOVERNORATES, ...extra];
}
