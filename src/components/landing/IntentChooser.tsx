"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ArrowRight, KeyRound, Search, Tag, Home } from "lucide-react";

/**
 * The three things people come to a property site for — sell, buy, rent —
 * as the first choice on the home page (cahier des charges, §2).
 *
 * « Je vends » and « J'achète » go straight somewhere: the publish form, the
 * catalogue narrowed to sales. « Je loue » cannot, because it means two
 * opposite things — an owner letting a flat and a tenant looking for one — so
 * it asks which, in place, and each answer is one more tap away. Nothing here
 * replaces the search box or the rails under it; this is a shortcut for
 * someone who knows what they want, not a gate in front of the catalogue.
 */
export function IntentChooser({ layout = "compact" }: { layout?: "compact" | "hero" }) {
  const t = useTranslations("home");
  const [rentOpen, setRentOpen] = useState(false);
  const hero = layout === "hero";

  const tile = cn(
    "tap-target group flex flex-col items-start gap-2 rounded-2xl text-start ring-1 transition",
    hero ? "p-4" : "p-3",
  );
  const quiet = "bg-surface ring-border hover:ring-gold-soft hover:bg-gold-faint/50";
  const icon = cn(
    "grid shrink-0 place-items-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold-soft",
    hero ? "size-10" : "size-9",
  );

  return (
    <div>
      <p className={cn("font-extrabold text-foreground", hero ? "text-[15px]" : "text-[14px]")}>
        {t("intentTitle")}
      </p>

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <Link href={"/annonces/nouvelle" as never} className={cn(tile, quiet)}>
          <span className={icon}>
            <Tag className="size-[18px]" />
          </span>
          <span>
            <span className={cn("block font-extrabold text-foreground", hero ? "text-[15px]" : "text-[13.5px]")}>
              {t("intentSell")}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t("intentSellHint")}</span>
          </span>
        </Link>

        <Link href={"/annonces?deal=sale" as never} className={cn(tile, quiet)}>
          <span className={icon}>
            <Search className="size-[18px]" />
          </span>
          <span>
            <span className={cn("block font-extrabold text-foreground", hero ? "text-[15px]" : "text-[13.5px]")}>
              {t("intentBuy")}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t("intentBuyHint")}</span>
          </span>
        </Link>

        <button
          type="button"
          aria-expanded={rentOpen}
          aria-controls="intent-rent"
          onClick={() => setRentOpen((v) => !v)}
          className={cn(tile, rentOpen ? "bg-gold-faint ring-2 ring-gold" : quiet)}
        >
          <span className={icon}>
            <KeyRound className="size-[18px]" />
          </span>
          <span>
            <span className={cn("block font-extrabold text-foreground", hero ? "text-[15px]" : "text-[13.5px]")}>
              {t("intentRent")}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t("intentRentHint")}</span>
          </span>
        </button>
      </div>

      {/* « Je loue » means two things; ask which, right where it was tapped. */}
      {rentOpen && (
        <div id="intent-rent" className="mt-2 rounded-2xl bg-surface p-3 ring-1 ring-gold-soft">
          <p className="text-[12.5px] font-bold text-foreground">{t("intentRentQuestion")}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Link
              href={"/annonces/nouvelle?deal=rent" as never}
              className="tap-target flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-border transition hover:ring-gold-soft"
            >
              <Home className="size-4 shrink-0 text-gold" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-extrabold text-foreground">{t("intentRentOwner")}</span>
                <span className="block text-[11px] text-muted">{t("intentRentOwnerHint")}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
            </Link>
            <Link
              href={"/annonces?deal=rent" as never}
              className="tap-target flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-border transition hover:ring-gold-soft"
            >
              <Search className="size-4 shrink-0 text-gold" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-extrabold text-foreground">{t("intentRentSeeker")}</span>
                <span className="block text-[11px] text-muted">{t("intentRentSeekerHint")}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
