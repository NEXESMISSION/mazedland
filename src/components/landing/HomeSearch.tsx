"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Search, MapPin } from "lucide-react";

const GOVERNORATES = [
  "Tunis", "Ariana", "Ben Arous", "Manouba",
  "Sousse", "Monastir", "Mahdia", "Nabeul",
  "Sfax", "Bizerte", "Gabès", "Médenine",
  "Kairouan", "Béja", "Jendouba", "Kef",
];

const TYPES = [
  { key: "apartment",  labelEn: "Apartment",  labelAr: "شقة" },
  { key: "villa",      labelEn: "Villa",      labelAr: "فيلا" },
  { key: "house",      labelEn: "House",      labelAr: "منزل" },
  { key: "land",       labelEn: "Land",       labelAr: "أرض" },
  { key: "commercial", labelEn: "Commercial", labelAr: "محل تجاري" },
  { key: "office",     labelEn: "Office",     labelAr: "مكتب" },
] as const;

/**
 * Home search — keyword + governorate + type, submits to /auctions.
 *
 * This is the marketplace's missing primary action: an inline search
 * the moment a user lands. Without it the home reads as a magazine
 * (browse-by-scroll); with it, intent-driven users can jump straight
 * to a filtered catalogue in one tap.
 *
 * Submits via `router.push` so the next-intl locale prefix is added
 * automatically and the navigation stays inside the SPA cache.
 */
export function HomeSearch({ isRTL }: { isRTL: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [gov, setGov] = useState("");
  const [type, setType] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (gov) params.set("gov", gov);
    if (type) params.set("type", type);
    const qs = params.toString();
    router.push((qs ? `/auctions?${qs}` : "/auctions") as `/auctions`);
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
              placeholder={isRTL ? "ابحث عن عقار..." : "Search auctions..."}
              className="w-full rounded-full bg-surface-2 py-3 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gold/40 ltr:pl-9 ltr:pr-3 rtl:pl-3 rtl:pr-9"
            />
          </div>
          <button
            type="submit"
            className="batta-gold-fill tap-target inline-flex size-11 shrink-0 items-center justify-center rounded-full shadow-[var(--shadow-gold)] ring-1 ring-black/10"
            aria-label={isRTL ? "بحث" : "Search"}
          >
            <Search className="size-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Second row: two native selects styled as soft pills. Native
            controls open the OS picker (full-screen sheet on iOS,
            drop-down on Android) — best mobile UX with zero code. */}
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <MapPin
              className="pointer-events-none absolute top-1/2 size-3.5 -translate-y-1/2 text-gold ltr:left-3 rtl:right-3"
              strokeWidth={2}
              aria-hidden
            />
            <select
              value={gov}
              onChange={(e) => setGov(e.target.value)}
              aria-label={isRTL ? "الولاية" : "Governorate"}
              className="tap-target w-full appearance-none rounded-full bg-surface-2 py-2.5 text-[12px] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40 ltr:pl-8 ltr:pr-3 rtl:pl-3 rtl:pr-8"
            >
              <option value="">{isRTL ? "كل الولايات" : "All wilayas"}</option>
              {GOVERNORATES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label={isRTL ? "النوع" : "Type"}
            className="tap-target flex-1 appearance-none rounded-full bg-surface-2 px-3 py-2.5 text-[12px] font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
          >
            <option value="">{isRTL ? "كل الأنواع" : "All types"}</option>
            {TYPES.map((tp) => (
              <option key={tp.key} value={tp.key}>
                {isRTL ? tp.labelAr : tp.labelEn}
              </option>
            ))}
          </select>
        </div>
      </form>
    </section>
  );
}
