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
export const ACTION_LABEL: Record<string, string> = {
  // Seller-side
  "listing.create": "Annonce créée",
  "listing.submit.free": "Annonce soumise (gratuite)",
  "listing.submit.payment": "Annonce soumise (payante)",
  "listing.renew": "Annonce renouvelée",
  logout: "Déconnexion",

  // Moderation
  "admin.listing.approve": "Annonce publiée",
  "admin.listing.republish": "Annonce remise en ligne",
  "admin.listing.reject": "Annonce refusée",
  "admin.listing.archive": "Annonce archivée",
  "admin.listing.extend": "Publication prolongée",
  "admin.listing.feature": "Mise en avant sur l'accueil",
  "admin.listing.unfeature": "Retirée de l'accueil",
  "admin.listing.mark_sold": "Annonce marquée vendue",
  "admin.listing.mark_paid": "Paiement enregistré",
  "admin.listing.waive_fee": "Publication offerte",
  "admin.listing.edit": "Annonce modifiée",
  "admin.listing.delete": "Annonce supprimée",
  "admin.listing.create": "Annonce créée par l'admin",
  "admin.listing.bulk_approve": "Publication groupée",
  "admin.listing.bulk_archive": "Archivage groupé",
  "admin.listing.bulk_extend": "Prolongation groupée",

  // Money
  "admin.payment.accept": "Reçu validé",
  "admin.payment.reject": "Reçu refusé",
  "payment.captured": "Paiement validé",
  "payment.failed": "Paiement refusé",
  "payment.manual": "Paiement manuel enregistré",

  // Offers
  "admin.product.create": "Offre créée",
  "admin.product.update": "Offre modifiée",
  "admin.product.deactivate": "Offre retirée de la vente",

  // People
  "admin.user.set_role": "Rôle modifié",
  "admin.user.ban": "Compte suspendu",
  "admin.user.unban": "Compte réactivé",
  "admin.seller.grant_credits": "Forfait crédité",
  "admin.seller.grant_badge": "Badge accordé",
  "admin.seller.revoke_badge": "Badge retiré",
  "user.admin_update": "Compte modifié",

  // Catalogue + site
  "admin.category.create": "Catégorie créée",
  "admin.category.update": "Catégorie modifiée",
  "admin.category.toggle": "Catégorie activée / désactivée",
  "admin.attribute.create": "Caractéristique ajoutée",
  "admin.attribute.update": "Caractéristique modifiée",
  "admin.attribute.delete": "Caractéristique supprimée",
  "admin.settings.update": "Réglages modifiés",
  "home.feature": "Mise en avant sur l'accueil",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}
