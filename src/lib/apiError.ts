/**
 * A sentence for an API error payload, in the reader's language.
 *
 * Every client here did `toast(j.detail ?? j.error ?? "…")`, and `j.error` is a
 * code: sellers saw « listing_update_failed » while typing a title, « auth »
 * when a session expired, « payment_already_resolved » on a receipt. A `detail`
 * written for people is used as-is (routes write it in the caller's language
 * with apiTranslator); a known code is translated from the `apiErrors`
 * namespace; anything else falls back to the caller's sentence.
 *
 * In a client component, use the hook: `const apiError = useApiError();`
 * then `toast(apiError(j, t("saveFailed")), "error")`.
 */
export const API_ERROR_CODES = [
  "auth",
  "rate_limited",
  "cross_origin_blocked",
  "server_misconfigured",
  "not_configured",
  "bad_request",
  "not_owner",
  "listing_not_found",
  "listing_update_failed",
  "listing_submit_failed",
  "not_submittable",
  "contact_required",
  "payment_create_failed",
  "payment_already_resolved",
  "payment_not_found",
  "receipt_required",
  "signed_url_failed",
  "listing_status_failed",
  "listing_relist_failed",
  "unknown_action",
  "too_large",
  "empty_body",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const isCode = (v: unknown): v is ApiErrorCode =>
  typeof v === "string" && (API_ERROR_CODES as readonly string[]).includes(v);

export function apiErrorMessage(
  payload: unknown,
  fallback: string,
  translate: (code: ApiErrorCode) => string,
): string {
  const { error, detail } = (payload ?? {}) as { error?: unknown; detail?: unknown };
  // A detail that is itself a code (snake_case, no spaces) is not a sentence.
  if (typeof detail === "string" && detail.trim() && !/^[a-z0-9_.]+$/.test(detail.trim())) {
    return detail.trim();
  }
  if (isCode(error)) return translate(error);
  return fallback;
}
