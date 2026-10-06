import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // French is the default; Arabic (Tunisian) is served at /ar, right-to-left.
  // A visitor with no locale cookie whose browser prefers Arabic is sent to /ar
  // from "/"; the language switcher sets the cookie either way.
  locales: ["fr", "ar"] as const,
  defaultLocale: "fr",
  localePrefix: "always",
  localeCookie: {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
});

export type Locale = (typeof routing.locales)[number];

export function stripLocalePrefix(path: string): string {
  for (const locale of routing.locales) {
    if (path === `/${locale}`) return "/";
    if (path.startsWith(`/${locale}/`)) return path.slice(locale.length + 1);
  }
  return path;
}
