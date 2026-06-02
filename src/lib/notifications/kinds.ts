// ─── Broadcast notification kinds — form schema ─────────────────────────────
// Each broadcast type has a different shape: titles + bodies are universal, but
// maintenance carries a scheduled time, promos carry an expiry + promo code,
// alerts carry a severity, etc. Title / body / link land in their dedicated
// columns on `notifications`; everything else is stored in
// `notifications.payload` (jsonb) via the broadcast_notification RPC.
//
// To add a new kind: append an entry to KIND_CONFIG and the admin form +
// payload builder pick it up — no other code changes needed. This lives in lib
// (not inside the admin client component) so the same single source of truth
// can back both the form and any server-side payload validation.

export type FieldType =
  | "text"
  | "textarea"
  | "url"
  | "datetime"
  | "number"
  | "select"
  | "checkbox";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  options?: { value: string; label: string }[];
  helper?: string;
};

export type KindDef = {
  value: string;
  label: string;
  description: string;
  fields: FieldDef[];
};

// Fields whose key is one of these go into top-level notification columns;
// everything else flows into payload jsonb.
export const CORE_FIELD_KEYS = new Set(["title", "body", "link"]);

export const KIND_CONFIG: KindDef[] = [
  {
    value: "announcement",
    label: "Annonce",
    description: "Nouvelle fonctionnalité, changement de politique, communication produit.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Nouvelle fonctionnalité disponible" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Décrivez l'annonce." },
      { key: "link", label: "Lien (optionnel)", type: "url", maxLength: 500, placeholder: "/properties" },
      { key: "cta_label", label: "Libellé du bouton", type: "text", maxLength: 60, placeholder: "En savoir plus", helper: "Texte du bouton d'action affiché avec le lien." },
    ],
  },
  {
    value: "maintenance",
    label: "Maintenance",
    description: "Indisponibilité planifiée, fenêtre de maintenance.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Maintenance programmée" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Détails de la maintenance." },
      { key: "scheduled_at", label: "Début prévu", type: "datetime", required: true, helper: "Heure locale (Tunis)." },
      { key: "duration_min", label: "Durée (minutes)", type: "number", placeholder: "60" },
      { key: "affected", label: "Services impactés", type: "text", maxLength: 200, placeholder: "Enchères, paiements" },
    ],
  },
  {
    value: "promo",
    label: "Promo / actualité",
    description: "Offre limitée, événement, mise en avant d'une enchère.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Enchère spéciale ce week-end" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Détails de la promo." },
      { key: "link", label: "Lien", type: "url", maxLength: 500, placeholder: "/auctions/abc" },
      { key: "cta_label", label: "Libellé du bouton", type: "text", maxLength: 60, placeholder: "Voir l'offre" },
      { key: "expires_at", label: "Expire le", type: "datetime", helper: "L'offre n'est plus valable après cette date." },
      { key: "promo_code", label: "Code promo", type: "text", maxLength: 40, placeholder: "BATTA2026" },
    ],
  },
  {
    value: "system_alert",
    label: "Alerte système",
    description: "Incident, problème connu, instruction d'action urgente.",
    fields: [
      { key: "title", label: "Titre", type: "text", required: true, maxLength: 200, placeholder: "Problème de paiement détecté" },
      { key: "body", label: "Message", type: "textarea", maxLength: 1000, placeholder: "Détails du problème et de la solution." },
      {
        key: "severity",
        label: "Sévérité",
        type: "select",
        required: true,
        options: [
          { value: "info", label: "Info" },
          { value: "warning", label: "Avertissement" },
          { value: "error", label: "Critique" },
        ],
      },
      { key: "action_required", label: "Action requise de l'utilisateur", type: "checkbox" },
    ],
  },
];

export const KIND_BY_VALUE = new Map(KIND_CONFIG.map((k) => [k.value, k]));
