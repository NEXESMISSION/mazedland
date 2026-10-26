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
