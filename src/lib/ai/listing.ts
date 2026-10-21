/**
 * The listing assistant (cahier des charges §3): one sentence in, a draft out.
 *
 *   « عندي دار في صفاقس، طريق قرمدة، 180 متر، نحب نبيعها بـ350 مليون »
 *     → maisons · Sfax · Route de Gremda · 180 m² · 350 000 TND · sale
 *
 * Pure: the instructions, the JSON schema the model answers in, and the code
 * that checks the answer before any of it reaches the form. The model only
 * READS — it never decides a price, a category or a legal fact on its own:
 *
 *   • a field the seller did not state stays null, and becomes a question;
 *   • a category or governorate outside the site's lists is dropped;
 *   • a legal claim (« titre foncier », « constructible ») is kept only when
 *     the seller's own words are quoted and found in what they wrote;
 *   • a contact detail in the generated text is removed, like in moderation.
 *
 * Every number the summary computes (price per m², move-in cost) is computed
 * by the code that already does it, never by the model.
 */
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { FURNISHED, isoDay, type DealType, type Furnished } from "@/lib/listings/deal";
import { hasContactInText, latinDigits, normalizeText } from "@/lib/moderation/rules";

export type DraftCategory = { slug: string; label: string; kind: string };

export type LegalField = "titled" | "buildable" | "serviced";

export type ListingDraft = {
  deal: DealType;
  categorySlug: string | null;
  governorate: string | null;
  delegation: string | null;
  price: number | null;
  areaSqm: number | null;
  rooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  furnished: Furnished | null;
  deposit: number | null;
  charges: number | null;
  availableFrom: string | null;
  minLeaseMonths: number | null;
  /** Only what the seller said in so many words (see legal_claims). */
  legal: Partial<Record<LegalField, boolean>>;
  title: string | null;
  description: string | null;
  questions: string[];
};

export function buildSystemPrompt(categories: DraftCategory[]): string {
  const cats = categories.map((c) => `- ${c.slug} (${c.label}, ${c.kind})`).join("\n");
  const govs = TUNISIAN_GOVERNORATES.join(", ");
  return `You help people in Tunisia put a property online on Mazed Immo, a classifieds site for selling and renting real estate. The seller describes the property in one or two sentences, in Tunisian Arabic (Derja, in Arabic or Latin script), Modern Standard Arabic or French, often mixed. Read it and return the listing fields as JSON.

Rules that matter more than anything else:
- Only use facts the seller stated. Never invent, estimate or "complete" a value. A field that was not said is null.
- When something important is missing or unclear, leave it null and ask about it in "questions" (at most 3, short, in the seller's own language and register). Do not ask about photos or the phone number; the form asks for those.
- Legal facts (land title "titre foncier"/"رسم عقاري", building permit, constructible land, connection to networks) go in "legal_claims" only when the seller stated them, with "quote" set to the exact words they used, copied from their text. Never infer them.
- Never put a phone number, e-mail address or link in the title or the description.

Reading Tunisian amounts (all prices are in Tunisian dinars, TND):
- In Derja, "مليون" / "melyoun" about a price means 1 000 TND (a thousand millimes): "350 مليون" = 350 000 TND, "80 مليون" = 80 000 TND.
- In French, "million de dinars", "MD", "MDT" is a real million: "1,5 million de dinars" = 1 500 000 TND.
- "ألف" / "alf" / "mille" / "k" multiply by 1 000: "200 ألف" = 200 000 TND, "1200 dinars" = 1 200 TND.
- "مليار" / "melyar" = 1 000 000 TND: "1 مليار و200 مليون" = 1 200 000 TND.
- Surfaces in hectares: 1 ha = 10 000 m².
- If the unit cannot be told apart (for example a bare "350" for a house), set price_tnd to null, price_unclear to true, and ask.
- A rent ("كراء", "نكري", "à louer", "par mois", "في الشهر") is a monthly amount.

Reading the property:
- deal_type: "sale" for selling (نبيع، بيع، à vendre), "rent" for renting out (نكري، للكراء، à louer). If it cannot be told, use "sale" and ask.
- "S+2", "S+3"… means that many rooms besides the living room: rooms = 2, 3…
- category_slug must be one of these slugs, or null:
${cats}
  دار / houch / maison → maisons; فيلا → villas; شقة / appartement → appartements; أرض / مقسم / lot / terrain → terrain; ضيعة / هنشير / ferme → fermes; حانوت / محل / local → locaux-commerciaux; مكتب / bureau → bureaux; مخزن / دبو / dépôt → depots.
- governorate must be exactly one of: ${govs} — or null. Write the French name (صفاقس → Sfax, سوسة → Sousse, نابل → Nabeul, تونس العاصمة → Tunis).
- delegation is the town, delegation or neighbourhood as the seller named it (keep it short), or null.
- furnished: "furnished" (مفروش / meublé), "semi" (نص مفروش), "unfurnished" (فارغ / vide), or null. Rent only.
- available_from: a date (YYYY-MM-DD) only if the seller gave one; deposit_tnd ("ضمان", "caution") and charges_tnd (monthly charges) only if stated. Rent only.

Writing:
- language: "ar" if the seller wrote in Arabic script or Derja, otherwise "fr".
- title: short, in the seller's language, in the order "type · surface · place" (for example "دار 180 م² · طريق قرمدة، صفاقس" or "Villa 300 m² · Hammamet"). No price in the title.
- description: 2 to 4 plain sentences in the seller's language, built only from what they said. No superlatives they did not use, no contact details.`;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** The JSON schema the model must answer in (structured outputs). */
export const LISTING_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "language", "deal_type", "category_slug", "governorate", "delegation", "price_tnd", "price_unclear",
    "area_sqm", "rooms", "bathrooms", "floor", "furnished", "deposit_tnd", "charges_tnd", "available_from",
    "min_lease_months", "legal_claims", "title", "description", "questions",
  ],
  properties: {
    language: { type: "string", enum: ["ar", "fr"] },
    deal_type: { type: "string", enum: ["sale", "rent"] },
    category_slug: nullable({ type: "string" }),
    governorate: nullable({ type: "string" }),
    delegation: nullable({ type: "string" }),
    price_tnd: nullable({ type: "number" }),
    price_unclear: { type: "boolean" },
    area_sqm: nullable({ type: "number" }),
    rooms: nullable({ type: "integer" }),
    bathrooms: nullable({ type: "integer" }),
    floor: nullable({ type: "integer" }),
    furnished: nullable({ type: "string", enum: ["furnished", "semi", "unfurnished"] }),
    deposit_tnd: nullable({ type: "number" }),
    charges_tnd: nullable({ type: "number" }),
    available_from: nullable({ type: "string", format: "date" }),
    min_lease_months: nullable({ type: "integer" }),
    legal_claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "quote"],
        properties: {
          field: { type: "string", enum: ["titled", "buildable", "serviced"] },
          value: { type: "boolean" },
          quote: { type: "string" },
        },
      },
    },
    title: { type: "string" },
    description: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
  },
} as const;

const inRange = (v: unknown, min: number, max: number, integer = false): number | null => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n) || n < min || n > max) return null;
  return integer ? Math.round(n) : Math.round(n * 100) / 100;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
};

/** Lines of generated text that carry a contact detail are dropped whole. */
function withoutContacts(s: string | null): string | null {
  if (!s) return s;
  const kept = s
    .split(/(?<=[.!؟?])\s+/)
    .filter((part) => !hasContactInText(part))
    .join(" ")
    .trim();
  return kept || null;
}

/**
 * The model's answer, checked against what the site accepts. Anything that
 * does not fit is dropped (null), never "corrected" into something plausible.
 */
export function normalizeListingDraft(
  raw: unknown,
  ctx: { categories: DraftCategory[]; sourceText: string },
): ListingDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const deal: DealType = r.deal_type === "rent" ? "rent" : "sale";
  const rent = deal === "rent";

  const slug = typeof r.category_slug === "string" ? r.category_slug.trim().toLowerCase() : "";
  const categorySlug = ctx.categories.some((c) => c.slug === slug) ? slug : null;

  const govRaw = typeof r.governorate === "string" ? r.governorate.trim().toLowerCase() : "";
  const governorate = TUNISIAN_GOVERNORATES.find((g) => g.toLowerCase() === govRaw) ?? null;

  // A sale under 1 000 TND or a rent over 200 000 is a misreading of the
  // amount, not a price: ask rather than fill the box with it.
  const price =
    r.price_unclear === true ? null : rent ? inRange(r.price_tnd, 50, 200_000) : inRange(r.price_tnd, 1_000, 100_000_000);

  // Legal facts: only when the quoted words are really in the seller's text.
  const source = normalizeText(latinDigits(ctx.sourceText));
  const legal: Partial<Record<LegalField, boolean>> = {};
  for (const c of Array.isArray(r.legal_claims) ? r.legal_claims : []) {
    const claim = (c ?? {}) as Record<string, unknown>;
    const field = claim.field;
    const quote = typeof claim.quote === "string" ? normalizeText(latinDigits(claim.quote)) : "";
    if ((field === "titled" || field === "buildable" || field === "serviced") && typeof claim.value === "boolean"
        && quote.length >= 3 && source.includes(quote)) {
      legal[field] = claim.value;
    }
  }

  const questions = (Array.isArray(r.questions) ? r.questions : [])
    .map((q) => text(q, 160))
    .filter((q): q is string => !!q && !hasContactInText(q))
    .slice(0, 3);

  return {
    deal,
    categorySlug,
    governorate,
    delegation: text(r.delegation, 60),
    price,
    areaSqm: inRange(r.area_sqm, 5, 10_000_000),
    rooms: inRange(r.rooms, 1, 30, true),
    bathrooms: inRange(r.bathrooms, 1, 20, true),
    floor: inRange(r.floor, 0, 80, true),
    furnished: rent && (FURNISHED as readonly unknown[]).includes(r.furnished) ? (r.furnished as Furnished) : null,
    deposit: rent ? inRange(r.deposit_tnd, 0, 1_000_000) : null,
    charges: rent ? inRange(r.charges_tnd, 0, 100_000) : null,
    availableFrom: rent ? isoDay(r.available_from) : null,
    minLeaseMonths: rent ? inRange(r.min_lease_months, 1, 120, true) : null,
    legal,
    title: withoutContacts(text(r.title, 140)),
    description: withoutContacts(text(r.description, 1200)),
    questions,
  };
}
