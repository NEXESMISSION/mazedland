import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "@/lib/settings/registry";
import { checkSetting } from "@/lib/settings/define";
import { SMS_KINDS } from "@/lib/sms-kinds";
import { NOTIFICATION_KINDS } from "./target";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0185_site_error_alerts.sql"), "utf8");

describe("site error alerts (0185)", () => {
  it("the trigger falls back to the defaults the console shows", () => {
    expect(sql).toContain(`setting_bool('feature_error_alerts', ${SETTINGS.feature_error_alerts.default})`);
    expect(sql).toContain(`setting_days('error_alert_hours', ${SETTINGS.error_alert_hours.default})`);
  });

  it("offers 1, 6 or 24 hours, nothing else", () => {
    for (const h of [1, 6, 24]) expect(checkSetting(SETTINGS.error_alert_hours, h).ok).toBe(true);
    expect(checkSetting(SETTINGS.error_alert_hours, 3).ok).toBe(false);
  });

  it("alerts only on production errors, and never loses the error row", () => {
    expect(sql).toMatch(/metadata ->> 'env', ''\) <> 'production'/);
    expect(sql).toMatch(/exception when others then[\s\S]*return null;/);
    expect(sql).toMatch(/when \(new\.type = 'error'\)/);
  });

  it("is an admin kind of the bell, never an SMS", () => {
    expect(sql).toContain("'admin_site_error'");
    expect((NOTIFICATION_KINDS as readonly string[]).includes("admin_site_error")).toBe(true);
    expect(SMS_KINDS.has("admin_site_error")).toBe(false);
  });
});
