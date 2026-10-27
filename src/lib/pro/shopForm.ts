/**
 * The shop form (0173), made so its owner types as little as possible: the
 * contacts the account already holds, the page's address as it will be, and
 * a first presentation written from what was chosen. Pure, tested on its own;
 * src/components/pro/ShopForm.tsx and the page that opens it use it.
 */
import { governorateLabel } from "@/lib/tunisia";
import { delegationLabel, placeKey } from "@/lib/delegations";
import { slugify, type ShopKind } from "./shops";

/**
 * The address POST /api/pro/shops will give a shop of this name, before the
 * short suffix it adds when that one is taken. A name with no Latin letters
 * gets « boutique- » and a random suffix there, shown as « … » here.
 */
export function slugPreview(name: string): string {
  const slug = slugify(name, "");
  return slug === "agence-" ? "agence-…" : slug;
}

/**
 * A slug as it is being typed: lower case, no accents, one dash for anything
 * else. A trailing dash stays — the next letter is on its way — and the API
 * refuses what is still wrong when it is sent.
 */
export function typedSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60);
}

/**
 * The account's e-mail when it is one a person reads. A phone account's is a
 * synthetic address on the signup domain (/api/auth/signup) that receives
 * nothing: offering it as the shop's contact would publish a dead address.
 */
export function readableEmail(email: string | null | undefined, syntheticDomain: string): string {
  const e = email?.trim() ?? "";
  if (!e || !syntheticDomain) return e;
  return e.toLowerCase().endsWith(`@${syntheticDomain.toLowerCase()}`) ? "" : e;
}

/** A stored number as a person writes it: « +216 22 123 456 ». Any other is left as it is. */
export function phoneForField(e164: string | null | undefined): string {
  const p = e164?.trim() ?? "";
  const m = /^\+216(\d{2})(\d{3})(\d{3})$/.exec(p);
  return m ? `+216 ${m[1]} ${m[2]} ${m[3]}` : p;
}

/** « à Sfax », « au Bardo » — the two délégations whose name starts with an article. */
export function frAt(place: string): string {
  if (/^Les /.test(place)) return `aux ${place.slice(4)}`;
  if (/^Le /.test(place)) return `au ${place.slice(3)}`;
  return `à ${place}`;
}

/** The délégation and its governorate in the reader's language, once when they share a name (« Monastir »). */
export function shopPlace(governorate: string, city: string, locale: string): string {
  const gov = governorate ? governorateLabel(governorate, locale) : "";
  const del = city.trim() ? delegationLabel(city.trim(), locale) : "";
  if (!del) return gov;
  if (!gov || placeKey(del) === placeKey(gov)) return del;
  return `${del}${locale === "ar" ? "، " : ", "}${gov}`;
}

type Words = { name: string; place: string };

/*
 * Each one opens on a word of its own language — « Bienvenue chez »,
 * « مرحبا بيكم في » — not on the shop's name: the presentation is shown with
 * dir="auto", which takes its direction from the first letter, and an Arabic
 * text that began with « Agence El Amen » would be laid out left to right.
 */
const FR: Record<ShopKind, (w: Words) => string> = {
  agency: ({ name, place }) =>
    `Bienvenue chez ${name}, agence immobilière${place ? ` ${frAt(place)}` : ""}. Nous vous accompagnons pour vendre, acheter ou louer : estimation, visites, négociation et suivi jusqu'à la signature. Contactez-nous, nous vous répondons rapidement.`,
  promoter: ({ name, place }) =>
    `Bienvenue chez ${name}, promoteur immobilier${place ? ` ${frAt(place)}` : ""}. Nous construisons des logements neufs — appartements, villas et locaux — et vous suivons de la réservation à la remise des clés. Contactez-nous pour découvrir nos projets.`,
  land_developer: ({ name, place }) =>
    `Bienvenue chez ${name}, lotisseur${place ? ` ${frAt(place)}` : ""}. Nous proposons des lots de terrain aménagés pour bâtir votre maison ou votre projet, avec un dossier clair. Contactez-nous pour connaître les lots disponibles.`,
  property_manager: ({ name, place }) =>
    `Bienvenue chez ${name}, gestion de biens immobiliers${place ? ` ${frAt(place)}` : ""} : mise en location, encaissement des loyers, entretien et suivi des locataires. Confiez-nous votre bien, nous nous occupons du reste.`,
};

const AR: Record<ShopKind, (w: Words) => string> = {
  agency: ({ name, place }) =>
    `مرحبا بيكم في ${name}، وكالة عقارية${place ? ` في ${place}` : ""}. نعاونوك باش تبيع، تشري ولا تكري: تقييم، زيارات، تفاوض ومتابعة حتى للإمضاء. اتصل بينا ونجاوبوك في أقرب وقت.`,
  promoter: ({ name, place }) =>
    `مرحبا بيكم في ${name}، باعث عقاري${place ? ` في ${place}` : ""}. نبنيو مساكن جديدة — شقق، فيلات ومحلات — ونرافقوك من الحجز حتى لتسليم المفاتيح. اتصل بينا باش تكتشف مشاريعنا.`,
  land_developer: ({ name, place }) =>
    `مرحبا بيكم في ${name}، مقسّم أراضي${place ? ` في ${place}` : ""}. نقترحو مقاسم أراضي مهيّأة باش تبني دارك ولا مشروعك، بملف واضح. اتصل بينا باش تعرف المقاسم المتوفّرة.`,
  property_manager: ({ name, place }) =>
    `مرحبا بيكم في ${name}، نتصرّفو في العقارات${place ? ` في ${place}` : ""}: كراء، استخلاص معاليم الكراء، صيانة ومتابعة المتسوّغين. خلّي عقارك عندنا وإحنا نتكفّلو بالباقي.`,
};

/**
 * « Écrire la présentation pour moi »: a short first text from the kind, the
 * name and the place, in the page's language. A template, not a model — it
 * says nothing the owner did not choose, and they edit it from there.
 */
export function shopPresentation(
  v: { kind: ShopKind; name: string; governorate: string; city: string },
  locale: string,
): string {
  const words: Words = { name: v.name.trim().replace(/\s+/g, " "), place: shopPlace(v.governorate, v.city, locale) };
  return (locale === "ar" ? AR : FR)[v.kind](words);
}
