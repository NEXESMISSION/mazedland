"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { normalizeSearchQuery } from "@/lib/search";
import { TUNISIAN_GOVERNORATES } from "@/lib/tunisia";
import { Search, MapPin } from "lucide-react";
import { SelectMenu, type SelectOption } from "@/components/ui/SelectMenu";

// Canonical 24-wilaya list (previously a truncated 16 here).
const GOVERNORATES = TUNISIAN_GOVERNORATES;

// Type keys are stable; labels come from `property.types.<key>` so each
// locale (ar/fr/en) gets its own translation through the same i18n file.
const TYPE_KEYS = ["apartment", "villa", "house", "land", "commercial", "office"] as const;

/**
 * Home search — keyword + governorate + type, submits to /properties.
 *
 * This is the marketplace's missing primary action: an inline search
 * the moment a user lands. Without it the home reads as a magazine
 * (browse-by-scroll); with it, intent-driven users can jump straight
 * to a filtered catalogue in one tap.
 *
 * Submits via `router.push` so the next-intl locale prefix is added
 * automatically and the navigation stays inside the SPA cache.
 */
export function HomeSearch({
  isRTL: _isRTL,
  layout = "stacked",
}: {
  isRTL: boolean;
  /** "stacked" — the original mobile two-row card (default, untouched).
   *  "bar" — a single horizontal row for the desktop hero. */
  layout?: "stacked" | "bar";
}) {
  void _isRTL;
  const router = useRouter();
  const t = useTranslations();
  const [q, setQ] = useState("");
  const [gov, setGov] = useState("");
  const [type, setType] = useState("");

  const govOptions: SelectOption[] = [
    { value: "", label: t("search.allWilayas") },
    ...GOVERNORATES.map((g) => ({ value: g, label: g })),
  ];
  const typeOptions: SelectOption[] = [
    { value: "", label: t("search.allTypes") },
    ...TYPE_KEYS.map((k) => ({ value: k, label: t(`property.types.${k}`) })),
  ];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    // Strip ilike wildcards + `or()` separators here so the
    // /properties server query doesn't have to re-clean the same input.
    const cleanQ = normalizeSearchQuery(q);
    if (cleanQ) params.set("q", cleanQ);
    if (gov) params.set("gov", gov);
    // The new Explore page expects `types` (comma-separated list); a
    // single picked type maps cleanly to a one-element list.
    if (type) params.set("types", type);
    const qs = params.toString();
    router.push((qs ? `/properties?${qs}` : "/properties") as `/properties`);
  }

  // Desktop hero variant — one horizontal row: keyword | governorate |
  // type | submit, divided by hairlines, no outer section padding so the
  // caller controls width + centering.
  if (layout === "bar") {
    return (
      <form
        onSubmit={submit}
        className="flex items-stretch gap-2 rounded-2xl bg-surface p-2 text-start ring-1 ring-border shadow-[0_14px_40px_-18px_rgba(15,23,42,0.25)]"
      >
        {/* Keyword absorbs the free space; the two selects size to their
            own (sometimes long) labels via shrink-0 so nothing clips. */}
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            className="pointer-events-none absolute size-4 text-muted ltr:left-4 rtl:right-4"
            strokeWidth={2}
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search.placeholder")}
            className="w-full rounded-xl bg-transparent py-3.5 text-[14px] text-foreground placeholder:text-muted focus:outline-none ltr:pl-11 ltr:pr-3 rtl:pl-3 rtl:pr-11"
          />
        </div>
        <div className="my-1.5 w-px shrink-0 bg-border" />
        <SelectMenu
          value={gov}
          onChange={setGov}
          options={govOptions}
          ariaLabel={t("search.governorate")}
          icon={<MapPin className="size-4 shrink-0 text-gold" strokeWidth={2} aria-hidden />}
          triggerClassName="flex w-44 shrink-0 cursor-pointer items-center gap-2 bg-transparent px-3.5 py-3.5 text-[13px] font-bold text-foreground focus:outline-none"
        />
        <div className="my-1.5 w-px shrink-0 bg-border" />
        <SelectMenu
          value={type}
          onChange={setType}
          options={typeOptions}
          ariaLabel={t("search.type")}
          align="end"
          triggerClassName="flex w-36 shrink-0 cursor-pointer items-center gap-2 bg-transparent px-4 py-3.5 text-[13px] font-bold text-foreground focus:outline-none"
        />
        <button
          type="submit"
          className="batta-gold-fill inline-flex shrink-0 items-center gap-2 rounded-xl px-7 text-[13px] font-extrabold shadow-[var(--shadow-gold)] ring-1 ring-black/10 transition active:scale-[0.98]"
        >
          <Search className="size-4" strokeWidth={2.5} />
          {t("search.submit")}
        </button>
      </form>
    );
  }

  return (
    <section className="px-4">
      <form
        onSubmit={submit}
        className="rounded-2xl bg-surface p-2 ring-1 ring-gold/20"
      >
        {/* Top row: keyword box + submit. Stays single-row even on
            narrow phones — the type + governorate pickers drop below. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted ltr:left-3.5 rtl:right-3.5"
              strokeWidth={2}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search.placeholder")}
              className="w-full rounded-full bg-surface-2 py-3 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gold/40 ltr:pl-9 ltr:pr-3 rtl:pl-3 rtl:pr-9"
            />
          </div>
          <button
            type="submit"
            className="batta-gold-fill tap-target inline-flex size-11 shrink-0 items-center justify-center rounded-full shadow-[var(--shadow-gold)] ring-1 ring-black/10"
            aria-label={t("search.submit")}
          >
            <Search className="size-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Second row: two soft-pill custom dropdowns (matching menus,
            chevron affordance, gold-checked selection). */}
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <SelectMenu
              value={gov}
              onChange={setGov}
              options={govOptions}
              ariaLabel={t("search.governorate")}
              icon={<MapPin className="size-3.5 shrink-0 text-gold" strokeWidth={2} aria-hidden />}
              triggerClassName="tap-target flex w-full items-center gap-2 rounded-full bg-surface-2 px-3 py-2.5 text-[12px] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
            />
          </div>
          <div className="flex-1">
            <SelectMenu
              value={type}
              onChange={setType}
              options={typeOptions}
              ariaLabel={t("search.type")}
              align="end"
              triggerClassName="tap-target flex w-full items-center gap-2 rounded-full bg-surface-2 px-3 py-2.5 text-[12px] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
            />
          </div>
        </div>
      </form>
    </section>
  );
}
