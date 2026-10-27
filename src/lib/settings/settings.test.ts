import { describe, it, expect } from "vitest";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import { checkSetting, readSetting, type SettingDef } from "./define";
import { SETTINGS, SETTING_GROUPS, type SettingKey } from "./registry";
import { clientSettings, settingsFromRows } from "./server";

const KEYS = Object.keys(SETTINGS) as SettingKey[];

describe("the registry", () => {
  it("ships defaults that pass their own checks", () => {
    for (const key of KEYS) {
      const def = SETTINGS[key] as SettingDef;
      if (def.default === null) continue;
      expect(checkSetting(def, def.default), key).toMatchObject({ ok: true });
    }
  });

  it("puts every setting in a tab the console shows", () => {
    for (const key of KEYS) expect(SETTING_GROUPS, key).toContain(SETTINGS[key].group);
  });

  it("never sends a secret to the browser", () => {
    for (const key of KEYS) {
      const def = SETTINGS[key] as SettingDef;
      expect(def.secret && def.client, key).toBeFalsy();
    }
    const all = settingsFromRows([{ key: "payee_rib", value: "12345678901234567890" }]);
    expect(clientSettings(all)).not.toHaveProperty("payee_rib");
    expect(clientSettings(all)).not.toHaveProperty("contact_email");
    expect(clientSettings(all)).toHaveProperty("feature_compare", true);
  });

  it("names every setting and tab in French and Arabic", () => {
    for (const [lang, m] of [["fr", fr], ["ar", ar]] as const) {
      const reg = (m as unknown as { settingsRegistry: Record<string, Record<string, unknown>> }).settingsRegistry;
      for (const key of KEYS) {
        expect(typeof reg[key]?.label, `${lang} ${key}.label`).toBe("string");
        expect(typeof reg[key]?.hint, `${lang} ${key}.hint`).toBe("string");
      }
      const groups = reg.groups as Record<string, { title?: unknown; hint?: unknown }>;
      for (const g of SETTING_GROUPS) {
        expect(typeof groups[g]?.title, `${lang} groups.${g}`).toBe("string");
        expect(typeof groups[g]?.hint, `${lang} groups.${g}.hint`).toBe("string");
      }
      const units = reg.units as Record<string, unknown>;
      for (const key of KEYS) {
        const unit = (SETTINGS[key] as { unit?: string }).unit;
        if (unit) expect(typeof units[unit], `${lang} units.${unit}`).toBe("string");
      }
    }
  });
});

describe("reading a stored value", () => {
  it("falls back to the default when it is missing or no longer fits", () => {
    const s = settingsFromRows([
      { key: "compare_max", value: 9 }, // out of range
      { key: "free_listing_limit", value: "abc" },
      { key: "feature_visits", value: "maybe" },
      { key: "listing_default_days", value: 45 },
    ]);
    expect(s.compare_max).toBe(3);
    expect(s.free_listing_limit).toBe(2);
    expect(s.feature_visits).toBe(true);
    expect(s.listing_default_days).toBe(45);
    expect(s.contact_whatsapp).toBe("+216 58 415 510");
  });

  it("keeps an empty VAT as « no VAT line », and a rate as a number", () => {
    expect(settingsFromRows([{ key: "invoice_vat_rate", value: "" }]).invoice_vat_rate).toBeNull();
    expect(settingsFromRows([]).invoice_vat_rate).toBeNull();
    expect(settingsFromRows([{ key: "invoice_vat_rate", value: 19 }]).invoice_vat_rate).toBe(19);
  });

  it("reads the banned words saved before the registry", () => {
    const s = settingsFromRows([{ key: "moderation_banned_words", value: ["arnaque", "urgent"] }]);
    expect(s.moderation_banned_words).toEqual(["arnaque", "urgent"]);
  });

  it("hands each caller its own copy of a list default", () => {
    const a = settingsFromRows([]);
    a.moderation_banned_words.push("x");
    expect(settingsFromRows([]).moderation_banned_words).toEqual([]);
  });
});

describe("checking what an admin typed", () => {
  const int = SETTINGS.compare_max as SettingDef;
  it("takes « 3 » and 3, refuses out of range and decimals", () => {
    expect(checkSetting(int, "3")).toEqual({ ok: true, value: 3 });
    expect(checkSetting(int, 4)).toEqual({ ok: true, value: 4 });
    expect(checkSetting(int, 5)).toEqual({ ok: false, error: "out_of_range" });
    expect(checkSetting(int, "2.5")).toEqual({ ok: false, error: "invalid_number" });
    expect(checkSetting(int, "")).toEqual({ ok: false, error: "invalid_number" });
  });
  it("takes a decimal comma for a number", () => {
    expect(checkSetting(SETTINGS.ai_daily_budget_usd as SettingDef, "2,5")).toEqual({ ok: true, value: 2.5 });
  });
  it("reads a switch from a form", () => {
    const b = SETTINGS.feature_visits as SettingDef;
    expect(checkSetting(b, "false")).toEqual({ ok: true, value: false });
    expect(checkSetting(b, 1)).toEqual({ ok: false, error: "invalid_bool" });
  });
  it("trims a text and refuses one too long", () => {
    const tx = SETTINGS.contact_whatsapp as SettingDef;
    expect(checkSetting(tx, "  +216 20 000 000 ")).toEqual({ ok: true, value: "+216 20 000 000" });
    expect(checkSetting(tx, "x".repeat(31))).toEqual({ ok: false, error: "too_long" });
  });
  it("splits a list by line, lower-cases, drops blanks and repeats", () => {
    const l = SETTINGS.moderation_banned_words as SettingDef;
    expect(checkSetting(l, "Arnaque\n\nurgent, ARNAQUE")).toEqual({ ok: true, value: ["arnaque", "urgent"] });
  });
  it("reads an unknown type of value as the default, never a crash", () => {
    expect(readSetting(SETTINGS.listing_max_photos as SettingDef, { nested: true })).toBe(12);
  });
});
