/**
 * The publish form's decisions that are not about drawing it
 * (src/app/[locale]/annonces/nouvelle/PublishWizard.tsx and its page).
 *
 * Pure, so the tests can pin them without a browser.
 */
import { asDealType, isDealType } from "./deal";

/**
 * Whether the newest draft may be reopened as it is, or the seller must be
 * asked first.
 *
 * Without ?draft= the form reopens the newest draft, so a call or a stray back
 * gesture does not cost the seller their work. But « J'ai un bien à louer »
 * sends ?deal=rent, and reopening a SALE draft from there put the seller on
 * its photos step with « Vendre » selected — not what they came to do. When
 * the deal they asked for is not the draft's, the form asks: resume that draft,
 * or start the other kind and leave the draft where it is.
 *
 * `opened` is ?draft= or ?edit=: the seller named the annonce, there is no
 * guess to question. No ?deal= (or a value that is not one) is no question
 * either.
 */
export function draftNeedsChoice({
  opened,
  askedDeal,
  draft,
}: {
  opened: boolean;
  askedDeal: unknown;
  draft: { deal_type?: string | null } | null;
}): boolean {
  if (opened || !draft || !isDealType(askedDeal)) return false;
  return asDealType(draft.deal_type) !== askedDeal;
}

/** The form's four steps: what and where, photos, price and details, summary. */
export type WizardStep = 0 | 1 | 2 | 3;

/** Which step each field lives on, so "missing" and "Modifier" land there. */
const STEP_OF: Record<string, WizardStep> = {
  "f-category": 0,
  "f-photos": 1,
  "f-price": 2,
  "f-rent": 2,
  "f-title": 2,
  "f-details": 2,
  "f-description": 2,
  "f-phone": 3,
  "f-contact": 3,
  "f-attestation": 3,
};

/**
 * A catalogue question's field id: `f-attr-area_sqm`. One per question, so a
 * missing surface is pointed at, not the whole « Le bien » block.
 */
export const attributeFieldId = (fieldKey: string) => `f-attr-${fieldKey}`;

export function stepOfField(id: string): WizardStep | undefined {
  // Catalogue questions all sit with the price and the details.
  if (id.startsWith("f-attr-")) return 2;
  return STEP_OF[id];
}

/**
 * What holds the seller on `step` when they press « Continuer ».
 *
 * Photos still uploading finish in the background, so only "no photo at all"
 * holds them on the photos step.
 */
export function missingOnStep<T extends { fieldId: string }>(
  missing: T[],
  step: WizardStep,
  { photosUploading }: { photosUploading: boolean },
): T[] {
  return missing.filter(
    (m) => stepOfField(m.fieldId) === step && !(m.fieldId === "f-photos" && photosUploading),
  );
}

/**
 * The missing fields named as one phrase: « le prix et le titre »,
 * « السعر والعنوان ». « Il manque 2 informations » left the seller to find
 * out which two; this is what the message says after the colon.
 */
export function listOfFields(names: string[], locale: string): string {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(unique);
  } catch {
    // An engine without Intl.ListFormat still names them.
    return unique.join(", ");
  }
}
