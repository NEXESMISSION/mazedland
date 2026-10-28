import { describe, expect, it } from "vitest";
import { creditedPeriodIds, invoiceLines, type InvoiceLineWords } from "./invoiceLines";

// The French words, flattened: what messages/fr.json says under invoice.lines.
const t: InvoiceLineWords = (key, v = {}) => {
  switch (key) {
    case "plan": return `Abonnement ${v.name}`;
    case "period": return `du ${v.from} au ${v.to}`;
    case "days": return `${v.count} jours`;
    case "quota": return `${v.count} annonces`;
    case "discount": return `Remise — temps restant de l'abonnement ${v.name}`;
    case "previousPlan": return "précédent";
  }
};

const total = (lines: { amount: number }[]) => lines.reduce((n, l) => n + l.amount, 0);

describe("invoiceLines", () => {
  it("an upgrade: the plan at its list price, then what the smaller plan's time took off", () => {
    const lines = invoiceLines(
      {
        kind: "subscription", amount: 31, label: "Pro",
        metadata: {
          change: "upgrade", list_price: 59, credit: 28, listing_quota: 40,
          credit_lines: [{ periodId: "p1", days: 31, amount: 28 }],
          starts_at: "2026-10-28T13:27:51.781Z", ends_at: "2026-11-28T13:27:51.781Z",
        },
      },
      { locale: "fr", t, planNames: { p1: "Starter" } },
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].label).toBe("Abonnement Pro");
    expect(lines[0].sub).toMatch(/^du 28 oct\. 2026 au 28 nov\. 2026 · 40 annonces$/);
    expect(lines[0].amount).toBe(59);
    expect(lines[1]).toEqual({ label: "Remise — temps restant de l'abonnement Starter", sub: "31 jours", amount: -28 });
    expect(total(lines)).toBe(31);
  });

  it("several periods taken off: the last line takes the odd dinar so the lines add up to what was paid", () => {
    const lines = invoiceLines(
      {
        kind: "subscription", amount: 61, label: "Business",
        metadata: { list_price: 119, credit: 58, credit_lines: [{ periodId: "a", days: 10, amount: 28 }, { periodId: "b", days: 20, amount: 29 }] },
      },
      { locale: "fr", t, planNames: { a: "Starter", b: "Pro" } },
    );
    expect(lines.map((l) => l.amount)).toEqual([119, -28, -30]);
    expect(total(lines)).toBe(61);
  });

  it("a discount without its lines still appears, on the previous plan", () => {
    const lines = invoiceLines(
      { kind: "subscription", amount: 40, label: "Pro", metadata: { list_price: 59 } },
      { locale: "fr", t },
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ label: "Remise — temps restant de l'abonnement précédent", sub: null, amount: -19 });
  });

  it("a plan quoted before the list price existed: one line, with its subscription row's dates", () => {
    const lines = invoiceLines(
      { kind: "subscription", amount: 119, label: "Business", metadata: { duration_days: 30, listing_quota: 120 } },
      { locale: "fr", t, period: { starts_at: "2026-12-26T19:46:29.854Z", ends_at: "2027-01-25T19:46:29.854Z" } },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(119);
    expect(lines[0].sub).toMatch(/^du 26 déc\. 2026 au 25 janv\. 2027 · 120 annonces$/);
  });

  it("an annonce's fee: its label as issued and its days; no annonces count", () => {
    const lines = invoiceLines(
      { kind: "listing_fee", amount: 15, label: "Annonce standard — « Terrains · Sfax »", metadata: { duration_days: 30, listing_quota: 1 } },
      { locale: "fr", t },
    );
    expect(lines).toEqual([{ label: "Annonce standard — « Terrains · Sfax »", sub: "30 jours", amount: 15 }]);
  });

  it("nothing known about the payment: one line, no detail", () => {
    expect(invoiceLines({ kind: null, amount: 10, label: "Service", metadata: null }, { locale: "fr", t }))
      .toEqual([{ label: "Service", sub: null, amount: 10 }]);
  });

  it("a list price below what was paid is ignored", () => {
    const lines = invoiceLines({ kind: "subscription", amount: 59, label: "Pro", metadata: { list_price: 29 } }, { locale: "fr", t });
    expect(lines).toEqual([{ label: "Abonnement Pro", sub: null, amount: 59 }]);
  });

  it("creditedPeriodIds reads the periods an upgrade's discount names", () => {
    expect(creditedPeriodIds({ credit_lines: [{ periodId: "a" }, { periodId: 3 }, null, { periodId: "b" }] })).toEqual(["a", "b"]);
    expect(creditedPeriodIds(null)).toEqual([]);
  });
});
