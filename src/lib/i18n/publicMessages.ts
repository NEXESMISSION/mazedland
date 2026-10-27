/**
 * The texts a public page sends to the browser: all of them but the
 * console's. Every page carried the admin's ~70 KB of labels (a third of the
 * file) in its HTML, for visitors who never open the console. The console's
 * layout gives its own pages the whole set again.
 */
import type { AbstractIntlMessages } from "next-intl";

/** Namespaces only the console reads: admin*, and the settings' labels. */
export const CONSOLE_ONLY = /^(admin([A-Z]\w*)?|settingsRegistry)$/;

export function publicMessages(all: AbstractIntlMessages): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(all).filter(([k]) => !CONSOLE_ONLY.test(k)));
}
