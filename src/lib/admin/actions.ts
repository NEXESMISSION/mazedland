/**
 * Action codes in the operator's words.
 *
 * Shared by the dashboard's "derniers gestes" strip and the full journal, so
 * the same event cannot be called two different things on two screens.
 *
 * Unmapped codes deliberately fall through to the raw value at the call site:
 * a new action showing up as `listing.foo` is a prompt to label it, whereas
 * hiding it makes the audit trail quietly incomplete.
 */
// The labels live in the `adminActions` messages (fr + ar). next-intl reads a
// dot in a key as nesting, so `admin.listing.approve` is stored as
// `admin_listing_approve`. A new action code needs its message added in both
// files; until then it shows raw.

/** The `adminActions` message key for an action code. */
export function actionKey(action: string): string {
  return action.replace(/\./g, "_");
}

/** A translator bound to `adminActions` — `getTranslations("adminActions")`. */
export type ActionTranslator = { (key: string): string; has(key: string): boolean };

/** An action code in the reader's language. Unmapped codes come back raw. */
export function actionText(t: ActionTranslator, action: string): string {
  if (!action) return action;
  const key = actionKey(action);
  return t.has(key) ? t(key) : action;
}
