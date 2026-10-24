import { asDealType, NO_RENT_FACTS, parseRentFacts } from "./deal";

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

export const MAX_PHOTOS = 12;

export function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
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
  if ("delegation" in body) fields.delegation = text(body.delegation, 60);
  if ("address" in body) fields.address = text(body.address, 200);
  if ("attributes" in body && body.attributes && typeof body.attributes === "object" && !Array.isArray(body.attributes)) {
    fields.attributes = body.attributes;
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

/** The gallery as it should end up, in order — or null when the body sends none. */
export function listingPhotos(body: ListingBody): PhotoRow[] | null {
  if (!Array.isArray(body.photos)) return null;
  return body.photos
    .slice(0, MAX_PHOTOS)
    .map((p) => text(((p ?? {}) as Record<string, unknown>).storage_path, 300))
    .filter((path): path is string => !!path)
    .map((storage_path, sort_order) => ({ storage_path, sort_order }));
}
