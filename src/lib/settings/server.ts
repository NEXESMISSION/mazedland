/**
 * The site's settings, read once per request (React `cache`) from
 * `app_settings`, with each registry default filling what is missing.
 *
 * One query for every setting rather than one per module: a page that asks
 * for the visit rules, the compare limit and the WhatsApp number costs a
 * single round trip, and a value changed in the console applies to the next
 * request — no deploy, no cache to wait for.
 */
import { cache } from "react";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { readSetting } from "./define";
import { SETTINGS, type SettingKey, type Settings, type ClientSettings } from "./registry";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** Every setting, from a row set as `app_settings` returns it. */
export function settingsFromRows(rows: readonly { key: string; value: unknown }[]): Settings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingKey, unknown>;
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    out[key] = byKey.has(key) ? readSetting(SETTINGS[key], byKey.get(key)) : readSetting(SETTINGS[key], undefined);
  }
  return out as Settings;
}

/** With a client already in hand (routes, crons, libraries). */
export async function loadSettings(admin: Admin | null): Promise<Settings> {
  if (!admin) return settingsFromRows([]);
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", Object.keys(SETTINGS));
  return settingsFromRows((data ?? []) as { key: string; value: unknown }[]);
}

/** In a server component or a route: once per request, however many ask. */
export const getSettings = cache(async (): Promise<Settings> => loadSettings(getServiceSupabase()));

/** What client components may read: the `client` settings, never a secret. */
export function clientSettings(all: Settings): ClientSettings {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const def = SETTINGS[key] as { client?: boolean; secret?: boolean };
    if (def.client && !def.secret) out[key] = all[key];
  }
  return out as ClientSettings;
}
