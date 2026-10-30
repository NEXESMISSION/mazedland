import { asDealType, NO_RENT_FACTS, parseRentFacts } from "./deal";
import { canonicalDelegation, governorateOfDelegation } from "@/lib/delegations";

/**
 * What the publish wizard sends, read the way the server trusts it — shared by
 * the draft route (POST /api/annonces) and the edit of a published annonce
 * (POST /api/annonces/:id/edit), so both write exactly the same columns.
 *
 * Only what is in the body is returned: a key the wizard did not send leaves
 * the column alone. Category existence and the seller's ownership are checked
 * by the routes, which hold the database.
 */
export type ListingBody = {
  id?: unknown;
  category_id?: unknown;
  title?: unknown;
  description?: unknown;
  price?: unknown;
  negotiable?: unknown;
  price_on_request?: unknown;
  governorate?: unknown;
  delegation?: unknown;
  address?: unknown;
  attributes?: unknown;
  contact_name?: unknown;
  contact_phone?: unknown;
  contact_whatsapp?: unknown;
  show_phone?: unknown;
  attestation_version?: unknown;
  photos?: unknown; // [{ storage_path, sort_order }]
  // Sale or rent (0166). The rent facts are only read alongside deal_type.
  deal_type?: unknown;
  deposit_amount?: unknown;
  charges_amount?: unknown;
  furnished?: unknown;
  available_from?: unknown;
  min_lease_months?: unknown;
};

/** `listing_max_photos` when nothing is stored; the routes pass the setting. */
export const MAX_PHOTOS = 12;

export function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** The widest price an annonce may carry, in TND: wider than any property, narrower than the column. */
export const MAX_PRICE = 1_000_000_000;

export function num(v: unknown): number | null {
  // Number(null), Number(""), Number(false) and Number([]) are all 0: a blank
  // price used to become a 0 TND annonce. Only a number, or a string of one.
  if (typeof v !== "number" && !(typeof v === "string" && v.trim() !== "")) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? Math.round(n * 100) / 100 : null;
}

/** Tunisian mobile/landline, loosely: +216 XX XXX XXX or 8 local digits. */
export function phone(v: unknown): string | null {
  const raw = text(v, 24);
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 8) return null;
  return digits.slice(0, 20);
}

/** The columns the body sets, typed and bounded. */
export function listingFields(body: ListingBody): Record<string, unknown> {
  const categoryId = text(body.category_id, 40);
  const title = text(body.title, 140);
  const governorate = text(body.governorate, 60);
  const priceOnRequest = body.price_on_request === true;
  const price = num(body.price);

  const fields: Record<string, unknown> = {};
  if (categoryId) fields.category_id = categoryId;
  if (title) fields.title = title;
  if ("description" in body) fields.description = text(body.description, 4000);
  if ("price" in body || "price_on_request" in body) {
    fields.price = priceOnRequest ? null : price;
    fields.price_on_request = priceOnRequest;
  }
  if ("negotiable" in body) fields.negotiable = body.negotiable === true;
  // A sale carries no rent facts (0166's check refuses them), so switching
  // from rent to sale clears what the seller typed for the rental.
  if ("deal_type" in body) {
    const deal = asDealType(body.deal_type);
    fields.deal_type = deal;
    Object.assign(fields, deal === "rent" ? parseRentFacts(body as Record<string, unknown>) : NO_RENT_FACTS);
  }
  if (governorate) fields.governorate = governorate;
  if ("address" in body) fields.address = text(body.address, 200);
  // The délégation is one of the governorate's (src/lib/delegations.ts), in
  // its stored spelling. A name off the list — a neighbourhood typed in the
  // old free field, « Ennasr » — is not lost: it becomes the quartier, unless
  // one was sent.
  if ("delegation" in body) {
    const typed = text(body.delegation, 80);
    const listed = canonicalDelegation(governorate ?? governorateOfDelegation(typed), typed);
    fields.delegation = listed;
    if (typed && !listed && !fields.address) fields.address = typed.slice(0, 200);
  }
  if ("attributes" in body && body.attributes && typeof body.attributes === "object" && !Array.isArray(body.attributes)) {
    fields.attributes = saneAttributes(body.attributes as Record<string, unknown>);
  }
  if ("contact_name" in body) fields.contact_name = text(body.contact_name, 80);
  if ("contact_phone" in body) fields.contact_phone = phone(body.contact_phone);
  if ("contact_whatsapp" in body) fields.contact_whatsapp = phone(body.contact_whatsapp);
  if ("show_phone" in body) fields.show_phone = body.show_phone !== false;
  if ("attestation_version" in body) {
    // Version only — the trigger stamps the moment with the server clock.
    fields.seller_attestation_version = text(body.attestation_version, 20);
  }
  return fields;
}

export type PhotoRow = { storage_path: string; sort_order: number };

/**
 * The gallery as it should end up, in order — or null when the body sends none.
 * At most `max` photos: what an admin allows per annonce in /admin/settings.
 */
export function listingPhotos(body: ListingBody, max = MAX_PHOTOS): PhotoRow[] | null {
  if (!Array.isArray(body.photos)) return null;
  return body.photos
    .slice(0, max)
    .map((p) => text(((p ?? {}) as Record<string, unknown>).storage_path, 300))
    .filter((path): path is string => !!path)
    .map((storage_path, sort_order) => ({ storage_path, sort_order }));
}

/**
 * The figures a property can have. A value outside them was a slip — « 13 »
 * typed for the year it was built, a surface with three zeros too many — and
 * is dropped rather than shown on the annonce and fed to the filters. Other
 * answers (yes/no, an admin's own questions) pass as sent.
 */
const ATTRIBUTE_BOUNDS: Record<string, [min: number, max: number]> = {
  area_sqm: [1, 10_000_000],
  rooms: [0, 50],
  bathrooms: [0, 20],
  floor: [0, 100],
  year_built: [1850, new Date().getFullYear() + 3],
};

/**
 * A figure given but impossible for a property: not a number, or outside its
 * bounds (a surface of 0 or −10 m², the year « 13 »). The form says so under
 * the field and in its summary, where saneAttributes would only drop it.
 */
export function attributeOutOfBounds(key: string, value: unknown): boolean {
  const bounds = ATTRIBUTE_BOUNDS[key];
  if (!bounds || value === null || value === undefined || String(value).trim() === "") return false;
  const n = Number(value);
  return !Number.isFinite(n) || n < bounds[0] || n > bounds[1];
}

/** Keys and text an annonce may carry: the forms send a few dozen short answers, not a payload. */
const MAX_ATTRIBUTE_KEYS = 60;
const MAX_ATTRIBUTE_TEXT = 200;

export function saneAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs).slice(0, MAX_ATTRIBUTE_KEYS)) {
    if (k.length > 64) continue;
    // Only what a form field holds: a number, a yes/no, a short text.
    if (!(typeof v === "number" || typeof v === "boolean" || typeof v === "string" || v === null)) continue;
    if (typeof v === "string" && v.length > MAX_ATTRIBUTE_TEXT) continue;
    const bounds = ATTRIBUTE_BOUNDS[k];
    if (bounds && v !== null && v !== "") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < bounds[0] || n > bounds[1]) continue;
      out[k] = n;
      continue;
    }
    out[k] = v;
  }
  return out;
}
