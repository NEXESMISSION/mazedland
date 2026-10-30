import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KIND_CONFIG, I18N_FIELD_KEYS } from "./kinds";
import { SMS_KINDS } from "@/lib/sms-kinds";
import { EMAIL_KINDS } from "@/lib/email-kinds";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0194_notifications.sql"), "utf8");

describe("broadcast kinds", () => {
  const kinds = KIND_CONFIG.map((k) => k.value);

  it("stay in the bell: none is a kind the SMS or e-mail drain sends", () => {
    // One broadcast to « all » of a kind the drains know would be a paid SMS
    // and an e-mail to every profile.
    for (const k of kinds) {
      expect(SMS_KINDS.has(k)).toBe(false);
      expect(EMAIL_KINDS.has(k)).toBe(false);
    }
  });

  it("are exactly the kinds broadcast_notification() accepts (0194)", () => {
    const m = /p_kind not in \(([^)]+)\)/.exec(sql);
    expect(m).not.toBeNull();
    const listed = (m![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ""));
    expect(new Set(listed)).toEqual(new Set(kinds));
    expect(sql).toContain("p_link !~ '^/([^/\\\\]|$)'");
  });

  it("each offer the Arabic copy beside the French", () => {
    for (const k of KIND_CONFIG) {
      const keys = new Set(k.fields.map((f) => f.key));
      for (const key of I18N_FIELD_KEYS) expect(keys.has(key)).toBe(true);
    }
  });
});
