import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale, locale: explicit }) => {
  // An explicit locale — getTranslations({ locale }) in a route handler, the
  // notification drains, apiTranslator — wins over the [locale] segment.
  const requested = explicit ?? (await requestLocale);
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
