// ─── Broadcast notification kinds — form schema ─────────────────────────────
// Each broadcast type has a different shape: titles + bodies are universal, but
// maintenance carries a scheduled time, promos carry an expiry + promo code,
// alerts carry a severity, etc. Title / body / link land in their dedicated
// columns on `notifications`; everything else is stored in
// `notifications.payload` (jsonb) via the broadcast_notification RPC.
//
// To add a new kind: append an entry to KIND_CONFIG, add its texts to
// messages (see below), and the admin form + payload builder pick it up — no
// other code changes needed. This lives in lib (not inside the admin client
// component) so the same single source of truth can back both the form and any
// server-side payload validation.
//
// The words the form shows live in messages/{fr,ar}.json, not here, so the
// form reads in the admin's language:
//   adminNotifications.kinds.<kind>.label | .description
//   adminNotifications.kinds.<kind>.fields.<field>.label
//   adminNotifications.kinds.<kind>.fields.<field>.placeholder   (when `placeholder`)
//   adminNotifications.kinds.<kind>.fields.<field>.helper        (when `helper`)
//   adminNotifications.kinds.<kind>.fields.<field>.options.<value>
// Kind values, field keys and option values are identifiers stored in the
// database and must not be translated.

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
  type: FieldType;
  required?: boolean;
  /** The field has a placeholder in messages. */
  placeholder?: boolean;
  maxLength?: number;
  /** Option values; each has a label in messages. */
  options?: string[];
  /** The field has a helper line in messages. */
  helper?: boolean;
};

export type KindDef = {
  value: string;
  fields: FieldDef[];
};

// Fields whose key is one of these go into top-level notification columns;
// everything else flows into payload jsonb.
export const CORE_FIELD_KEYS = new Set(["title", "body", "link"]);

export const KIND_CONFIG: KindDef[] = [
  {
    value: "announcement",
    fields: [
      { key: "title", type: "text", required: true, maxLength: 200, placeholder: true },
      { key: "body", type: "textarea", maxLength: 1000, placeholder: true },
      { key: "link", type: "url", maxLength: 500, placeholder: true },
      { key: "cta_label", type: "text", maxLength: 60, placeholder: true, helper: true },
    ],
  },
  {
    value: "maintenance",
    fields: [
      { key: "title", type: "text", required: true, maxLength: 200, placeholder: true },
      { key: "body", type: "textarea", maxLength: 1000, placeholder: true },
      { key: "scheduled_at", type: "datetime", required: true, helper: true },
      { key: "duration_min", type: "number", placeholder: true },
      { key: "affected", type: "text", maxLength: 200, placeholder: true },
    ],
  },
  {
    value: "promo",
    fields: [
      { key: "title", type: "text", required: true, maxLength: 200, placeholder: true },
      { key: "body", type: "textarea", maxLength: 1000, placeholder: true },
      { key: "link", type: "url", maxLength: 500, placeholder: true },
      { key: "cta_label", type: "text", maxLength: 60, placeholder: true },
      { key: "expires_at", type: "datetime", helper: true },
      { key: "promo_code", type: "text", maxLength: 40, placeholder: true },
    ],
  },
  {
    value: "system_alert",
    fields: [
      { key: "title", type: "text", required: true, maxLength: 200, placeholder: true },
      { key: "body", type: "textarea", maxLength: 1000, placeholder: true },
      {
        key: "severity",
        type: "select",
        required: true,
        options: ["info", "warning", "error"],
      },
      { key: "action_required", type: "checkbox" },
    ],
  },
];

export const KIND_BY_VALUE = new Map(KIND_CONFIG.map((k) => [k.value, k]));
