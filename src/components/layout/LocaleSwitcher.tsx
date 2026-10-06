"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * FR ⇄ ع. With two languages a menu is one tap too many: the pill shows the
 * language you would switch TO, in that language's own script, so a reader who
 * cannot read the current page can still find it.
 *
 * Switching keeps the page and its query string (filters, search) and lets
 * next-intl set the NEXT_LOCALE cookie, which "/" honours on the next visit.
 */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("localeSwitcher");
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const target = locale === "ar" ? "fr" : "ar";

  return (
    <button
      type="button"
      onClick={() =>
        startTransition(() => {
          // Read at click time: useSearchParams would force a Suspense
          // boundary on every statically rendered page that shows the bar.
          const query = window.location.search;
          router.replace(`${pathname}${query}`, { locale: target });
        })
      }
      disabled={pending}
      aria-label={t("switchTo")}
      title={t("switchTo")}
      lang={target}
      className={`tap-target inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-border px-2.5 text-[13px] font-bold text-foreground transition hover:bg-surface-2 active:scale-[0.97] disabled:opacity-60 ${
        target === "ar" ? "font-arabic text-[15px] leading-none" : ""
      } ${className}`}
    >
      {target === "ar" ? "ع" : "FR"}
    </button>
  );
}
