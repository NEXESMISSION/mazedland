/**
 * Consents (0182) — what a person accepted, which version, when. Pure: the
 * account page, the re-acceptance banner and the API read the same rules.
 *
 * Each answer is a row of `user_consents`; the latest row of a kind is the
 * person's current answer. The CGU and the privacy policy are accepted
 * together, against `legal_version` (Réglages → Données personnelles): when
 * an admin changes it, everyone signed in is asked again. SMS is its own
 * answer, given or withdrawn from the account page.
 */

export const CONSENT_KINDS = ["terms", "privacy", "sms"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** The two that make an account: accepted at signup, and again when they change. */
export const LEGAL_KINDS = ["terms", "privacy"] as const satisfies readonly ConsentKind[];

export const CONSENT_SOURCES = ["signup", "banner", "settings"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type ConsentRow = {
  kind: string;
  granted: boolean;
  version: string;
  source: string;
  created_at: string;
};

export function isConsentKind(k: unknown): k is ConsentKind {
  return typeof k === "string" && (CONSENT_KINDS as readonly string[]).includes(k);
}

/** The latest answer of each kind, whatever order the rows come in. */
export function currentConsents(rows: readonly ConsentRow[]): Partial<Record<ConsentKind, ConsentRow>> {
  const out: Partial<Record<ConsentKind, ConsentRow>> = {};
  for (const r of rows) {
    if (!isConsentKind(r.kind)) continue;
    const seen = out[r.kind];
    if (!seen || Date.parse(r.created_at) > Date.parse(seen.created_at)) out[r.kind] = r;
  }
  return out;
}

/**
 * Whether the person still has to accept the texts in force: one of them
 * never accepted, withdrawn, or accepted in another version. An account made
 * before consents were recorded has no row, so it is asked once.
 */
export function needsLegalAcceptance(current: Partial<Record<ConsentKind, ConsentRow>>, version: string): boolean {
  return LEGAL_KINDS.some((k) => {
    const c = current[k];
    return !c || !c.granted || c.version !== version;
  });
}
