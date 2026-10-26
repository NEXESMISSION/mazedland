"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * FR ⇄ ع. With two languages a menu is one tap too many: the pill shows the
 * language you would switch TO, in that language's own script, so a reader who
 * cannot read the current page can still find it.
 *
 * Switching keeps the page and its query string (filters, search) and lets
 * next-intl set the NEXT_LOCALE cookie, which "/" honours on the next visit —
 * and "/admin", where the installed console opens.
 *
 * `variant="row"` is the console rail's version: a full-width line with the
 * language's name, like the rail's other footer links.
 */
export function LocaleSwitcher({ className = "", variant = "pill" }: { className?: string; variant?: "pill" | "row" }) {
  const locale = useLocale();
  const t = useTranslations("localeSwitcher");
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const target = locale === "ar" ? "fr" : "ar";

  const onClick = () => {
    // Remember it on the profile too, so SMS and e-mails follow. A visitor
    // who is not signed in gets a 401 here, which is fine to ignore.
    fetch("/api/account/language", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: target }),
      keepalive: true,
    }).catch(() => {});
    startTransition(() => {
      // Read at click time: useSearchParams would force a Suspense
      // boundary on every statically rendered page that shows the bar.
      const query = window.location.search;
      router.replace(`${pathname}${query}`, { locale: target });
    });
  };

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title={t("switchTo")}
        className={`flex w-full items-center gap-2.5 px-4 py-[7px] text-[12.5px] font-medium text-subtle transition hover:text-foreground disabled:opacity-60 ${className}`}
      >
        <Languages className="size-4 shrink-0" strokeWidth={2} />
        <span lang={target} className={target === "ar" ? "font-arabic text-[13.5px]" : ""}>
          {target === "ar" ? "العربية" : "Français"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
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
