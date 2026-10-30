import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import fr from "../../messages/fr.json";
import ar from "../../messages/ar.json";
import { renderNotification } from "./notifications/render";
import { forSms } from "./sms-kinds";
import { needsUnicode, toGsmText, toSmsText } from "./winsms";

const BRAND = "Mazed Immo";
const URL = "https://www.mazed.immo/fr/account/visites?tab=sent&v=0b1c2d3e-4f50-4617-8899-aabbccddeeff";
const TITLE = "Appartement S+2 à Lac 2 avec vue sur mer";
const confirmed = (title: string) =>
  `Votre visite de « ${title} » est confirmée : lundi 2 novembre · l'après-midi.`;

describe("toSmsText", () => {
  it("sends a French notification in the GSM-7 alphabet, « » and all", () => {
    // « » alone used to make every annonce notification unicode: 70 characters
    // a part instead of 160, so three or four billed parts for one sentence.
    const { text, unicode } = toSmsText({ brand: BRAND, title: "Visite confirmée", body: confirmed(TITLE), url: URL });
    expect(unicode).toBe(false);
    expect(text).toBe(
      `Mazed Immo\nVisite confirmée\nVotre visite de "${TITLE}" est confirmée : lundi 2 novembre - l'après-midi.\n${URL}`,
    );
  });

  it("keeps the day of the visit and shortens the title instead", () => {
    const { text, unicode } = toSmsText({ brand: BRAND, title: "Visite confirmée", body: confirmed(TITLE), url: URL, maxLen: 220 });
    expect(unicode).toBe(false);
    expect(text.length).toBeLessThanOrEqual(220);
    expect(text).toContain("est confirmée : lundi 2 novembre - l'après-midi.");
    expect(text).toContain('"Appartement S+2');
    expect(text).toContain('..." est');
    expect(text).toContain(`\n${URL}`);
  });

  it("does the same in Arabic, sent as unicode and exactly as written", () => {
    const long = "Appartement S+2 à Lac 2 avec vue sur mer, proche de la plage et des écoles, garage";
    const body = `زيارتك لـ « ${long} » مأكّدة: الاثنين 2 نوفمبر · العشية.`;
    const { text, unicode } = toSmsText({ brand: BRAND, title: "الزيارة مأكّدة", body, url: URL });
    expect(unicode).toBe(true);
    expect(text.length).toBeLessThanOrEqual(210);
    expect(text).toContain("« Appartement S+2");
    expect(text).toContain("... » مأكّدة: الاثنين 2 نوفمبر · العشية.");
    expect(text).toContain(`\n${URL}`);
  });

  it("cuts the end only when even a short title does not fit", () => {
    const { text } = toSmsText({ brand: BRAND, title: "Visite confirmée", body: confirmed(TITLE), url: URL, maxLen: 160 });
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text.startsWith("Mazed Immo\nVisite confirmée\nVotre visite de \"Appartem...\"")).toBe(true);
    expect(text.endsWith(`\n${URL}`)).toBe(true);
  });

  it("stays plain for the French letters and signs GSM-7 has, flattens the others", () => {
    expect(toSmsText({ brand: BRAND, title: "S+2 à La Marsa", body: "Prix : 350 000 TND, 2e étage." }).unicode).toBe(false);
    const { text, unicode } = toSmsText({ brand: BRAND, title: "Reçu refusé", body: "Votre annonce expire bientôt — « Cœur de ville » sera retirée." });
    expect(unicode).toBe(false);
    expect(text).toBe('Mazed Immo\nRecu refusé\nVotre annonce expire bientot - "Coeur de ville" sera retirée.');
  });

  it("drops the body when there is no room for a readable one", () => {
    const { text } = toSmsText({ brand: BRAND, title: "Visite confirmée", body: confirmed(TITLE), url: URL, maxLen: 130 });
    expect(text).toBe(`Mazed Immo\nVisite confirmée\n${URL}`);
  });
});

describe("the SMS of a notification, end to end", () => {
  // The QA tour's repro: a real template, the site's own renderer, the SMS
  // builder — in both languages the day and the half-day survive a long title.
  const tr = (locale: "fr" | "ar") =>
    createTranslator({ locale, messages: locale === "fr" ? fr : ar, namespace: "notifications" });
  const row = {
    kind: "visit_confirmed",
    title: "Visite confirmée",
    body: "Votre visite de « … » est confirmée.",
    payload: {
      vars: {
        title: "Appartement S+2 à Lac 2 avec vue sur mer, proche de la plage et des écoles, garage",
        visit_day: "2026-11-02",
        visit_part: "afternoon",
        note: "Versez 200 DT d'acompte avant",
        variant: "with_note",
      },
    },
  };

  it("in French: one GSM-7 message that still says lundi 2 novembre, l'après-midi", () => {
    const said = renderNotification(forSms(row, "Un acheteur"), tr("fr"), "fr");
    const { text, unicode } = toSmsText({ brand: BRAND, title: said.title, body: said.body, url: URL });
    expect(unicode).toBe(false);
    expect(text).toContain("est confirmée : lundi 2 novembre - l'après-midi.");
    expect(text).not.toContain("Versez");
    expect(text.length).toBeLessThanOrEqual(300);
  });

  it("in Arabic: unicode, the title shortened, the day kept", () => {
    const said = renderNotification(forSms(row, "زائر"), tr("ar"), "ar");
    const { text, unicode } = toSmsText({ brand: BRAND, title: said.title, body: said.body, url: URL });
    expect(unicode).toBe(true);
    expect(text).toContain("العشية");
    expect(text).toContain("نوفمبر");
    expect(text).toContain("...");
    expect(text).not.toContain("Versez");
    expect(text.length).toBeLessThanOrEqual(210);
  });

  it("names the buyer of a visit request generically", () => {
    const request = {
      kind: "visit_requested",
      title: "Demande de visite",
      body: "x",
      payload: { vars: { title: "Villa Gammarth", name: "Appelez le 20123456 urgent", count: 2 } },
    };
    const said = renderNotification(forSms(request, "Un acheteur"), tr("fr"), "fr");
    expect(said.body).toBe("Un acheteur souhaite visiter « Villa Gammarth ». Répondez depuis Mes visites.");
    expect(renderNotification(forSms(request, "زائر"), tr("ar"), "ar").body).toContain("زائر يحب يزور");
  });
});

describe("toGsmText / needsUnicode", () => {
  it("flattens typography and the French letters outside GSM-7, nothing else", () => {
    expect(toGsmText("L’annonce « Villa » — 1 000 TND… bientôt")).toBe('L\'annonce "Villa" - 1 000 TND... bientot');
    expect(toGsmText("été à Hammamet")).toBe("été à Hammamet");
  });

  it("knows what the operator bills as unicode", () => {
    expect(needsUnicode("Votre code de vérification Mazed Immo est : 123456. Valable 10 minutes.")).toBe(false);
    expect(needsUnicode("S+2 #3 *")).toBe(false);
    expect(needsUnicode("« Villa »")).toBe(true);
    expect(needsUnicode("إعلانك منشور")).toBe(true);
  });
});
