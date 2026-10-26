"use client";

import { useTranslations } from "next-intl";
import { Scale, X } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { useCompare } from "./compareStore";

/**
 * The comparison's tray: shows once something is picked, above the phone's
 * bottom bar, with the way to the comparison and to empty it. Not on the
 * comparison itself, the publish form or the console.
 */
export function CompareBar() {
  const t = useTranslations("compare");
  const pathname = usePathname();
  const { ids, clear } = useCompare();
  if (ids.length === 0 || /^\/(comparer|admin|annonces\/nouvelle)(\/|$)/.test(pathname)) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mazed-bottombar-h,64px)+env(safe-area-inset-bottom)+8px)] z-30 flex justify-center px-4 lg:bottom-6">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-foreground py-1.5 pe-1.5 ps-4 text-[var(--background)] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.55)]">
        <Scale className="size-4 shrink-0" />
        <span className="text-[12.5px] font-bold">{t("picked", { count: ids.length })}</span>
        <Link
          href={`/comparer?ids=${ids.join(",")}` as never}
          aria-disabled={ids.length < 2}
          className={`rounded-full bg-[var(--background)] px-3.5 py-1.5 text-[12.5px] font-extrabold text-foreground ${ids.length < 2 ? "pointer-events-none opacity-50" : ""}`}
        >
          {t("open")}
        </Link>
        <button type="button" onClick={clear} aria-label={t("clear")} className="grid size-7 place-items-center rounded-full text-[var(--background)] hover:bg-white/15">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
