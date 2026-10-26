"use client";

import { createContext, useContext } from "react";
import { SETTINGS, type ClientSettingKey, type ClientSettings } from "@/lib/settings/registry";
import { readSetting } from "@/lib/settings/define";

/**
 * The settings client components apply — feature switches, the limits a form
 * enforces before sending — as the layout read them for this request. Outside
 * the provider (a test, a page rendered without the layout) each one is its
 * registry default, which is how the site behaved before it had settings.
 */
const DEFAULTS = Object.fromEntries(
  (Object.keys(SETTINGS) as (keyof typeof SETTINGS)[])
    .filter((k) => (SETTINGS[k] as { client?: boolean }).client)
    .map((k) => [k, readSetting(SETTINGS[k], undefined)]),
) as ClientSettings;

const Ctx = createContext<ClientSettings>(DEFAULTS);

export function SettingsProvider({ value, children }: { value: ClientSettings; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `const on = useSetting("feature_compare")`. */
export function useSetting<K extends ClientSettingKey>(key: K): ClientSettings[K] {
  return useContext(Ctx)[key];
}
