import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import { renderNotification } from "./render";

const tr = (locale: "fr" | "ar") =>
  createTranslator({ locale, messages: locale === "fr" ? fr : ar, namespace: "notifications" });

const expiring = {
  kind: "listing_expiring",
  title: "Votre annonce expire bientôt",
  body: "stored body",
  payload: { vars: { title: "Villa · Sidi Mansour", expires_at: "2026-10-09T22:30:00+00:00" } },
};

describe("renderNotification", () => {
  it("renders the French template, dated in Tunisian time", () => {
    // 22:30 UTC on the 9th is 23:30 in Tunis — still the 9th, not the 10th.
    expect(renderNotification(expiring, tr("fr"), "fr")).toEqual({
      title: "Votre annonce expire bientôt",
      body: "« Villa · Sidi Mansour » reste en ligne jusqu'au 09/10. Vous pourrez la renouveler dès ce jour-là.",
    });
  });

  it("renders the same row in Arabic for an Arabic reader", () => {
    const out = renderNotification(expiring, tr("ar"), "ar");
    expect(out.title).toBe("إعلانك قريب يوفى");
    expect(out.body).toContain("« Villa · Sidi Mansour »");
    expect(out.body).toContain("09");
  });

  it("formats amounts and names the payment kind", () => {
    const n = {
      kind: "admin_receipt_pending",
      title: "x",
      body: "x",
      payload: { vars: { amount: 15, paymentKind: "listing_fee" } },
    };
    expect(renderNotification(n, tr("fr"), "fr").body).toBe("Un reçu de frais d'annonce (15 TND) attend votre validation.");
    expect(renderNotification(n, tr("ar"), "ar").body).toBe("وصل معلوم نشر إعلان (15 د.ت) في انتظار المصادقة.");
  });

  it("uses real plurals", () => {
    const n = (count: number) => ({ kind: "credits_expired", title: "x", body: "x", payload: { vars: { count } } });
    expect(renderNotification(n(1), tr("fr"), "fr").body).toBe("Votre publication restante a expiré.");
    expect(renderNotification(n(3), tr("fr"), "fr").body).toBe("Vos 3 publications restantes ont expiré.");
    expect(renderNotification(n(3), tr("ar"), "ar").body).toBe("انتهت صلاحية 3 عمليات نشر متبقية.");
    expect(renderNotification(n(2), tr("ar"), "ar").body).toBe("انتهت صلاحية عمليتي النشر المتبقيتين.");
  });

  it("picks the variant's wording", () => {
    const n = {
      kind: "listing_payment_received",
      title: "x",
      body: "x",
      payload: { vars: { title: "Terrain", variant: "captured" } },
    };
    expect(renderNotification(n, tr("fr"), "fr").title).toBe("Paiement validé");
  });

  it("keeps the stored text for old rows and kinds without a template", () => {
    const old = { kind: "listing_expired", title: "Annonce expirée", body: "« A » n'est plus visible.", payload: {} };
    expect(renderNotification(old, tr("ar"), "ar")).toEqual({ title: old.title, body: old.body });
    const broadcast = { kind: "announcement", title: "Maintenance ce soir", body: "…", payload: { vars: { x: 1 } } };
    expect(renderNotification(broadcast, tr("ar"), "ar")).toEqual({ title: broadcast.title, body: broadcast.body });
  });
});
