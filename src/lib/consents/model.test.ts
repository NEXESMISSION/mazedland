import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentConsents, needsLegalAcceptance, type ConsentRow } from "./model";
import { SETTINGS } from "@/lib/settings/registry";
import { checkSetting } from "@/lib/settings/define";

const row = (kind: string, granted: boolean, version: string, at: string, source = "signup"): ConsentRow => ({
  kind, granted, version, source, created_at: at,
});

describe("consents", () => {
  it("takes the latest answer of each kind, whatever the order", () => {
    const c = currentConsents([
      row("sms", false, "2026-10", "2026-10-20T10:00:00Z", "settings"),
      row("sms", true, "2026-10", "2026-10-25T10:00:00Z", "settings"),
      row("sms", false, "2026-10", "2026-10-22T10:00:00Z", "settings"),
      row("unknown", true, "x", "2026-10-26T10:00:00Z"),
    ]);
    expect(c.sms?.granted).toBe(true);
    expect(Object.keys(c)).toEqual(["sms"]);
  });

  it("asks an account with no answer — made before consents were recorded", () => {
    expect(needsLegalAcceptance({}, "2026-10")).toBe(true);
  });

  it("does not ask again once both texts are accepted in the version in force", () => {
    const c = currentConsents([
      row("terms", true, "2026-10", "2026-10-27T10:00:00Z"),
      row("privacy", true, "2026-10", "2026-10-27T10:00:00Z"),
    ]);
    expect(needsLegalAcceptance(c, "2026-10")).toBe(false);
  });

  it("asks again when an admin changes the version, until the new one is accepted", () => {
    const old = [
      row("terms", true, "2026-10", "2026-10-27T10:00:00Z"),
      row("privacy", true, "2026-10", "2026-10-27T10:00:00Z"),
    ];
    expect(needsLegalAcceptance(currentConsents(old), "2026-11")).toBe(true);
    const answered = [
      ...old,
      row("terms", true, "2026-11", "2026-11-02T10:00:00Z", "banner"),
      row("privacy", true, "2026-11", "2026-11-02T10:00:00Z", "banner"),
    ];
    expect(needsLegalAcceptance(currentConsents(answered), "2026-11")).toBe(false);
  });

  it("asks when only one of the two texts was accepted, or one was withdrawn", () => {
    expect(needsLegalAcceptance(currentConsents([row("terms", true, "v", "2026-10-27T10:00:00Z")]), "v")).toBe(true);
    const withdrawn = currentConsents([
      row("terms", true, "v", "2026-10-27T10:00:00Z"),
      row("privacy", false, "v", "2026-10-27T11:00:00Z"),
    ]);
    expect(needsLegalAcceptance(withdrawn, "v")).toBe(true);
  });

  it("SMS answers never decide whether the texts must be accepted", () => {
    const c = currentConsents([
      row("terms", true, "v", "2026-10-27T10:00:00Z"),
      row("privacy", true, "v", "2026-10-27T10:00:00Z"),
      row("sms", false, "old", "2026-10-28T10:00:00Z", "settings"),
    ]);
    expect(needsLegalAcceptance(c, "v")).toBe(false);
  });
});

describe("retention periods (0182)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0182_consents_and_retention.sql"), "utf8");
  const calls = Array.from(sql.matchAll(/setting_days\('(\w+)', (\d+)\)/g)).map((m) => [m[1], Number(m[2])] as const);

  it("the nightly jobs fall back to the defaults the console shows", () => {
    expect(calls.length).toBe(5);
    for (const [key, fallback] of calls) {
      expect(key in SETTINGS, key).toBe(true);
      expect(SETTINGS[key as keyof typeof SETTINGS].default, key).toBe(fallback);
    }
  });

  it("every period the console offers is one the jobs read", () => {
    for (const [key] of calls) {
      const def = SETTINGS[key as keyof typeof SETTINGS];
      expect(def.type).toBe("int");
      if (def.type !== "int" || !("choices" in def)) throw new Error(key);
      for (const c of def.choices) expect(checkSetting(def, c).ok, `${key}=${c}`).toBe(true);
      expect(checkSetting(def, 45).ok, `${key}=45 is not offered`).toBe(false);
    }
  });

  it("IP addresses are always cleared: « jamais » is not offered for them", () => {
    expect((SETTINGS.privacy_anonymize_days.choices as readonly number[]).includes(0)).toBe(false);
    expect(sql).toMatch(/greatest\(1, public\.setting_days\('privacy_anonymize_days'/);
  });

  it("never deletes payments, invoices or the admin audit trail", () => {
    const deletes = Array.from(sql.matchAll(/delete from public\.(\w+)/g)).map((m) => m[1]);
    expect(deletes.sort()).toEqual(["activity_log", "activity_log", "contact_reveals", "listing_views", "notifications"]);
  });
});
