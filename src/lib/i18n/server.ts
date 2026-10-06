import { getTranslations } from "next-intl/server";
import { asAppLocale, type AppLocale } from "./index";

/**
 * The language of the page that made an API request, for route handlers that
 * return a sentence the UI shows verbatim (`detail`, toast text).
 *
 * Route handlers live outside [locale], so next-intl cannot tell on its own.
 * The page's URL is the most reliable signal: every fetch from the site is
 * same-origin, and the Referrer-Policy (strict-origin-when-cross-origin) sends
 * the full path for those — "/ar/annonces/…" means Arabic. The NEXT_LOCALE
 * cookie is the fallback, then French.
 */
export function requestLocale(req: Request): AppLocale {
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const first = new URL(referer).pathname.split("/")[1];
      if (first === "ar" || first === "fr") return first;
    } catch {
      /* malformed header — fall through */
    }
  }
  const cookie = req.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(cookie);
  return asAppLocale(m?.[1]);
}

/**
 * A translator for an API route, in the requesting page's language:
 *
 *   const t = await apiTranslator(req, "api.annonces");
 *   return NextResponse.json({ error: "invalid", detail: t("titleTooShort") }, { status: 400 });
 */
export async function apiTranslator(req: Request, namespace: string) {
  return getTranslations({ locale: requestLocale(req), namespace });
}
