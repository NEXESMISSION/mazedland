/**
 * A French sentence for an API error payload.
 *
 * Every client here did `toast(j.detail ?? j.error ?? "…")`, and `j.error` is a
 * code: sellers saw « listing_update_failed » while typing a title, « auth »
 * when a session expired, « payment_already_resolved » on a receipt. A `detail`
 * written for people is used as-is; a code is translated; anything unknown
 * falls back to the caller's sentence.
 */
const MESSAGES: Record<string, string> = {
  auth: "Votre session a expiré. Reconnectez-vous pour continuer.",
  rate_limited: "Trop de tentatives. Réessayez dans quelques minutes.",
  cross_origin_blocked: "Requête refusée. Rechargez la page et réessayez.",
  server_misconfigured: "Service momentanément indisponible. Réessayez plus tard.",
  not_configured: "Service momentanément indisponible. Réessayez plus tard.",
  bad_request: "Données incomplètes. Vérifiez le formulaire.",
  not_owner: "Cette annonce n'est pas la vôtre.",
  listing_not_found: "Annonce introuvable.",
  listing_update_failed: "Enregistrement impossible. Vérifiez les champs et réessayez.",
  listing_submit_failed: "Envoi impossible pour le moment. Réessayez.",
  not_submittable: "Cette annonce a déjà été envoyée.",
  contact_required: "Ajoutez un numéro de téléphone joignable.",
  payment_create_failed: "Impossible de créer le paiement. Réessayez.",
  payment_already_resolved: "Ce paiement est déjà traité.",
  payment_not_found: "Paiement introuvable.",
  receipt_required: "Joignez le reçu du virement.",
  signed_url_failed: "Envoi des photos impossible. Réessayez.",
  too_large: "Fichier trop volumineux.",
  empty_body: "Fichier vide.",
};

export function frenchApiError(payload: unknown, fallback: string): string {
  const { error, detail } = (payload ?? {}) as { error?: unknown; detail?: unknown };
  // A detail that is itself a code (snake_case, no spaces) is not a sentence.
  if (typeof detail === "string" && detail.trim() && !/^[a-z0-9_.]+$/.test(detail.trim())) {
    return detail.trim();
  }
  if (typeof error === "string" && MESSAGES[error]) return MESSAGES[error];
  return fallback;
}
