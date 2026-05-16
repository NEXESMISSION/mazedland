import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // Arabic is the default — primary market is Tunisia. French and English
  // are supported for francophone Tunisians and the diaspora / foreign
  // investors flagged in the business plan (TRE, EU, Gulf).
  locales: ["ar", "fr", "en"] as const,
  defaultLocale: "ar",
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
