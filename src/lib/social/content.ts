/**
 * The text of a social post, per channel and language.
 *
 *   🏠 À VENDRE · Maison S+3 · 180 m² · Route de Gremda, Sfax
 *   💰 350 000 DT
 *   ✔️ Titre foncier
 *   👉 Photos et détails : https://…/fr/annonces/…?utm_source=facebook…
 *   Réf. MZ-1A2B3C
 *   #MazedImmo #Sfax #AVendre
 *
 * Pure, and built only from the annonce's own fields — never from its free
 * text, which a seller writes and moderation reads; the post must not say
 * anything the annonce does not, and must never carry a phone number. A
 * legal fact (titre foncier, constructible) is said only when the seller
 * ticked it.
 *
 * Every post carries the request's reference (« MZ-1A2B3C »). It is how a
 * buyer quotes it, and how the engine recognises a post already online
 * after a timeout instead of posting it twice.
 */
import { formatTND } from "@/lib/utils";
import { governorateLabel } from "@/lib/tunisia";
import { asDealType, type DealType, type Furnished } from "@/lib/listings/deal";
import { redactContacts } from "@/lib/moderation/rules";
import { UTM_SOURCE, type SocialChannel, type SocialLanguage } from "./channels";

export type SocialListing = {
  id: string;
  dealType: DealType;
  categorySlug: string | null;
  categoryFr: string;
  categoryAr: string | null;
  governorate: string;
  delegation: string | null;
  price: number | null;
  priceOnRequest: boolean;
  areaSqm: number | null;
  rooms: number | null;
  furnished: Furnished | null;
  availableFrom: string | null;
  titled: boolean;
  buildable: boolean;
};

type ListingRow = {
  id: string;
  deal_type?: string | null;
  price: number | string | null;
  price_on_request: boolean | null;
  governorate: string;
  delegation: string | null;
  attributes: Record<string, unknown> | null;
  furnished?: string | null;
  available_from?: string | null;
  category?: { slug: string; label_fr: string; label_ar: string | null } | null;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/** The annonce as the generator reads it, from its database row. */
export function socialListingFrom(row: ListingRow): SocialListing {
  const a = row.attributes ?? {};
  const deal = asDealType(row.deal_type);
  return {
    id: row.id,
    dealType: deal,
    categorySlug: row.category?.slug ?? null,
    categoryFr: row.category?.label_fr ?? "",
    categoryAr: row.category?.label_ar ?? null,
    governorate: row.governorate,
    delegation: row.delegation,
    price: num(row.price),
    priceOnRequest: row.price_on_request === true,
    areaSqm: num(a.area_sqm),
    rooms: num(a.rooms),
    furnished:
      deal === "rent" && (row.furnished === "furnished" || row.furnished === "semi" || row.furnished === "unfurnished")
        ? row.furnished
        : null,
    availableFrom: deal === "rent" ? (row.available_from ?? null) : null,
    titled: a.titled === true || a.titled === "true",
    buildable: a.buildable === true || a.buildable === "true",
  };
}

/** « MZ-1A2B3C » from the ref column (0170). */
export function referenceCode(ref: string): string {
  return `MZ-${ref.toUpperCase()}`;
}

/**
 * The annonce's address with the UTM tags the tracking reads back
 * (src/app/api/social/track). `group` tells one Facebook group from another.
 */
export function trackedUrl(
  origin: string,
  listingId: string,
  opts: { ref: string; channel: SocialChannel; language: SocialLanguage; group?: string | null },
): string {
  const lang = opts.language === "ar" ? "ar" : "fr";
  const q = new URLSearchParams({
    utm_source: UTM_SOURCE[opts.channel],
    utm_medium: "social",
    utm_campaign: `mz-${opts.ref.toLowerCase()}`,
  });
  if (opts.group) q.set("utm_content", opts.group);
  return `${origin.replace(/\/+$/, "")}/${lang}/annonces/${listingId}?${q}`;
}

/** The short link an Instagram caption can carry, since it cannot carry a link. */
export function shortUrl(origin: string, ref: string): string {
  return `${origin.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/p/${ref.toUpperCase()}`;
}

/** What /annonces/<id>?utm_… says about where the visit came from. */
export function readTracking(params: { utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null }) {
  if (params.utm_medium !== "social") return null;
  const m = /^mz-([0-9a-f]{6})$/i.exec(params.utm_campaign ?? "");
  if (!m) return null;
  return { ref: m[1].toUpperCase(), source: params.utm_source ?? null };
}

// ── Words ──────────────────────────────────────────────────────────────────

/** Category labels are plural (« Maisons »); a post is about one. */
const SINGULAR: Record<string, { fr: string; ar: string }> = {
  maisons: { fr: "Maison", ar: "دار" },
  villas: { fr: "Villa", ar: "فيلا" },
  appartements: { fr: "Appartement", ar: "شقة" },
  terrain: { fr: "Terrain", ar: "أرض" },
  terrains: { fr: "Terrain", ar: "أرض" },
  fermes: { fr: "Ferme", ar: "ضيعة" },
  "locaux-commerciaux": { fr: "Local commercial", ar: "محل تجاري" },
  bureaux: { fr: "Bureau", ar: "مكتب" },
  depots: { fr: "Dépôt", ar: "مستودع" },
};

type Lang = "fr" | "ar";

const W = {
  fr: {
    sale: "À VENDRE",
    rent: "À LOUER",
    currency: "DT",
    perMonth: "/ mois",
    onRequest: "Prix sur demande",
    furnished: { furnished: "Meublé", semi: "Semi-meublé", unfurnished: "Vide" },
    availableNow: "Libre immédiatement",
    availableOn: (d: string) => `Libre le ${d}`,
    titled: "Titre foncier",
    buildable: "Constructible",
    details: "Photos et détails",
    ref: "Réf.",
    inBio: "lien dans la bio",
    dealTag: { sale: "AVendre", rent: "ALouer" },
    country: "ImmobilierTunisie",
  },
  ar: {
    sale: "للبيع",
    rent: "للكراء",
    currency: "د.ت",
    perMonth: "في الشهر",
    onRequest: "السعر عند الطلب",
    furnished: { furnished: "مفروش", semi: "نصف مفروش", unfurnished: "فارغ" },
    availableNow: "متوفّر حالًا",
    availableOn: (d: string) => `متوفّر من ${d}`,
    titled: "رسم عقاري",
    buildable: "صالح للبناء",
    details: "التصاور والتفاصيل",
    ref: "المرجع:",
    inBio: "الرابط في البيو",
    dealTag: { sale: "للبيع", rent: "للكراء" },
    country: "عقارات_تونس",
  },
} as const;

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** « Ben Arous » → BenArous, « Médenine » → Medenine, « سيدي بوزيد » → سيدي_بوزيد. */
export function hashtag(word: string): string {
  const arabic = /[؀-ۿ]/.test(word);
  const clean = arabic
    ? word.trim().replace(/\s+/g, "_")
    : word
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[\s'’-]+/)
        .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ""))
        .join("");
  const tag = clean.replace(/[^\p{L}\p{N}_]/gu, "");
  return tag ? `#${tag}` : "";
}

/**
 * Latin text inside an Arabic line (« S+2 », « Sakiet Ezzit »), isolated
 * (U+2066 … U+2069) so the line keeps its order: without it the dots and the
 * « + » around it are pulled the wrong way and « شقة S+2 · 110 م² » reads
 * scrambled. Invisible on Facebook and Instagram.
 */
export function isolate(s: string, lang: Lang): string {
  return lang === "ar" && /[A-Za-z]/.test(s) ? `⁦${s}⁩` : s;
}

function noun(l: SocialListing, lang: Lang): string {
  const s = l.categorySlug ? SINGULAR[l.categorySlug] : undefined;
  if (s) return s[lang];
  return (lang === "ar" ? l.categoryAr : null) || l.categoryFr;
}

function place(l: SocialListing, lang: Lang): string {
  const gov = governorateLabel(l.governorate, lang);
  const delegation = l.delegation ? redactContacts(l.delegation).replace(/\[…\]/g, "").trim() : "";
  if (!delegation || delegation.toLowerCase() === l.governorate.toLowerCase()) return gov;
  return `${isolate(delegation, lang)}${lang === "ar" ? "، " : ", "}${gov}`;
}

function priceText(l: SocialListing, lang: Lang): string {
  const w = W[lang];
  if (l.priceOnRequest || l.price == null) return w.onRequest;
  // Grouped with spaces in both languages: ar-TN groups with a dot, and in
  // Tunisia « 1.200 د.ت » reads as one dinar two hundred millimes.
  const amount = `${formatTND(l.price, "fr")} ${w.currency}`;
  return l.dealType === "rent" ? `${amount} ${w.perMonth}` : amount;
}

function facts(l: SocialListing, lang: Lang, today: string): string[] {
  const w = W[lang];
  const out: string[] = [];
  if (l.dealType === "rent") {
    if (l.furnished) out.push(w.furnished[l.furnished]);
    if (l.availableFrom) out.push(l.availableFrom <= today ? w.availableNow : w.availableOn(dmy(l.availableFrom)));
  }
  if (l.titled) out.push(w.titled);
  if (l.buildable) out.push(w.buildable);
  return out;
}

function headline(l: SocialListing, lang: Lang): string {
  const w = W[lang];
  const what = l.rooms ? `${noun(l, lang)} ${isolate(`S+${l.rooms}`, lang)}` : noun(l, lang);
  const area = l.areaSqm ? `${formatTND(l.areaSqm, "fr")} ${lang === "ar" ? "م²" : "m²"}` : null;
  return [w[l.dealType], what, area, place(l, lang)].filter(Boolean).join(" · ");
}

/** One language's block: headline, price, facts. Emojis on the pages, none in the groups. */
function block(l: SocialListing, lang: Lang, today: string, plain: boolean): string[] {
  const f = facts(l, lang, today);
  const sep = lang === "ar" ? "، " : " · ";
  if (plain) {
    return [headline(l, lang), priceText(l, lang), ...(f.length ? [f.join(sep)] : [])];
  }
  return [
    `${l.dealType === "rent" ? "🔑" : "🏠"} ${headline(l, lang)}`,
    `💰 ${priceText(l, lang)}`,
    ...(f.length ? [`✔️ ${f.join(sep)}`] : []),
  ];
}

function hashtags(l: SocialListing, channel: SocialChannel, langs: Lang[]): string[] {
  if (channel === "facebook_groups") return [];
  const tags = new Set<string>(["#MazedImmo"]);
  for (const lang of langs) {
    tags.add(hashtag(governorateLabel(l.governorate, lang)));
    tags.add(hashtag(W[lang].dealTag[l.dealType]));
    if (channel === "instagram") {
      tags.add(hashtag(noun(l, lang)));
      tags.add(hashtag(W[lang].country));
    }
  }
  if (channel === "instagram") tags.add(langs.includes("ar") ? "#تونس" : "#Tunisie");
  return [...tags].filter(Boolean).slice(0, 12);
}

export type GeneratedPost = {
  body: string;
  /** The link the post carries (a group's own is made at copy time). */
  linkUrl: string;
  hashtags: string[];
};

/**
 * The post for one channel. `origin` is the site's address (siteUrl());
 * `ref` the request's reference; `today` an ISO day, for « libre le … ».
 */
export function generatePost(input: {
  listing: SocialListing;
  channel: SocialChannel;
  language: SocialLanguage;
  origin: string;
  ref: string;
  today: string;
}): GeneratedPost {
  const { listing: l, channel, language, origin, ref, today } = input;
  const langs: Lang[] = language === "both" ? ["ar", "fr"] : [language];
  const plain = channel === "facebook_groups";
  const linkUrl = trackedUrl(origin, l.id, { ref, channel, language });
  const code = referenceCode(ref);
  const both = langs.length === 2;

  const lines: string[] = [];
  langs.forEach((lang, i) => {
    if (i > 0) lines.push("");
    lines.push(...block(l, lang, today, plain));
  });
  lines.push("");

  if (channel === "instagram") {
    // A line in both languages starts in French, so it runs left to right
    // and the link stays in one piece.
    const label = both ? `${W.fr.details} · ${W.ar.details}` : W[langs[0]].details;
    const bio = both ? W.fr.inBio : W[langs[0]].inBio;
    lines.push(`🔗 ${label} : ${shortUrl(origin, ref)} (${bio})`);
  } else {
    const label = both ? `${W.fr.details} · ${W.ar.details}` : W[langs[0]].details;
    lines.push(`${plain ? "" : "👉 "}${label} : ${linkUrl}`);
  }
  lines.push(both ? `${W.fr.ref} ${code}` : `${W[langs[0]].ref} ${code}`);

  const tags = hashtags(l, channel, langs);
  if (tags.length) lines.push("", tags.join(" "));

  return { body: lines.join("\n").slice(0, 2200), linkUrl, hashtags: tags };
}

/** The line added on top of a post once the annonce is sold or let. */
export function closedNotice(deal: DealType, language: SocialLanguage): string {
  const fr = deal === "rent" ? "✅ LOUÉ — cette annonce n'est plus disponible." : "✅ VENDU — cette annonce n'est plus disponible.";
  const ar = deal === "rent" ? "✅ تكرى — الإعلان هذا ما عادش متوفّر." : "✅ تباع — الإعلان هذا ما عادش متوفّر.";
  if (language === "fr") return fr;
  if (language === "ar") return ar;
  return `${ar}\n${fr}`;
}
