"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ListingImage } from "@/components/media/ListingImage";
import { FavoriteButton } from "@/components/property/FavoriteButton";
import { formatTND } from "@/lib/utils";
import { Heart, ImageOff, MapPin, Search } from "lucide-react";

/** One saved annonce, with its words already in the page's language. */
export type SavedItem = {
  id: string;
  title: string;
  category: string;
  place: string;
  price: number | null;
  priceOnRequest: boolean;
  rent: boolean;
  coverPath: string | null;
  /** No longer published: kept in the list, marked « plus disponible ». */
  gone: boolean;
};

/**
 * The favourites themselves — the list, its count and its empty state.
 *
 * A client component so that removing a favourite shows at once. The page
 * used to be all server-rendered: « Retirer des favoris » emptied the heart
 * but the card stayed and the count still said 1 until the page was left and
 * opened again. Now the card goes on the tap, the count and the empty state
 * follow, and if the write fails the heart rolls back (FavoriteButton says
 * why in a toast) and the card comes back where it was.
 */
export function FavoritesList({ items }: { items: SavedItem[] }) {
  const t = useTranslations("account.favorites");
  const locale = useLocale();
  // Ids taken off on this page. Filtering keeps the order, so a card that
  // comes back after a failed write lands in its old place.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const visible = items.filter((i) => !removed.has(i.id));

  const follow = (id: string) => (saved: boolean) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      if (saved) next.delete(id);
      else next.add(id);
      return next;
    });

  const priceLabel = (i: SavedItem, onRequest: string) =>
    i.priceOnRequest || i.price == null
      ? onRequest
      : t(i.rent ? "pricePerMonth" : "price", { amount: formatTND(i.price, locale) });

  return (
    <>
      <header>
        <h1 className="inline-flex items-center gap-2 text-[24px] font-extrabold tracking-tight">
          <Heart className="size-5 text-gold" strokeWidth={2.4} /> {t("title")}
        </h1>
        {/* Polite live region: a screen reader hears the new count when a
            card leaves, since the card itself just disappears. */}
        <p className="mt-1 text-[13px] text-muted" aria-live="polite">
          {visible.length === 0 ? t("subtitleEmpty") : t("subtitleCount", { count: visible.length })}
        </p>
      </header>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface-2/40 p-8 text-center">
          <p className="text-[13px] text-muted">{t("emptyBody")}</p>
          <Link
            href={"/annonces" as never}
            className="mazed-btn-luxe tap-target mt-4 inline-flex px-5 py-2.5 text-[13px]"
          >
            <Search className="size-4" /> {t("browse")}
          </Link>
        </div>
      ) : (
        <>
          {/* Phone: a list. A saved annonce is scanned by name and price, and a
              row puts both on one line at a readable size. */}
          <div className="mt-5 space-y-3 lg:hidden">
            {visible.map((i) => (
              <article
                key={i.id}
                className={"flex gap-3 rounded-2xl border border-border bg-surface p-3 " + (i.gone ? "opacity-70" : "")}
              >
                <Link
                  href={`/annonces/${i.id}` as never}
                  className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border"
                >
                  {i.coverPath ? (
                    <ListingImage path={i.coverPath} alt="" sizes="80px" fit="cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-muted">
                      <ImageOff className="size-5" />
                    </span>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">{i.category}</span>
                  <Link href={`/annonces/${i.id}` as never} className="block">
                    <h2 className="mt-0.5 truncate text-[14.5px] font-bold text-foreground hover:text-gold">{i.title}</h2>
                  </Link>
                  <p className="mazed-tabular mt-0.5 text-[13.5px] font-extrabold text-foreground">
                    {priceLabel(i, t("priceOnRequest"))}
                  </p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                    <MapPin className="size-3" /> {i.place}
                    {i.gone && <span className="ms-2 font-bold text-[var(--accent-deep)]">· {t("unavailable")}</span>}
                  </p>
                </div>

                <div className="self-start">
                  <FavoriteButton listingId={i.id} initialSaved loggedIn size="sm" onSavedChange={follow(i.id)} />
                </div>
              </article>
            ))}
          </div>

          {/* Desktop: the cards the catalogue uses, so a saved annonce looks
              like the thing that was saved. */}
          <div className="mt-6 hidden gap-5 lg:grid lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((i) => (
              <article
                key={i.id}
                className={
                  "group relative overflow-hidden rounded-2xl border border-border bg-surface transition hover:border-gold-soft " +
                  (i.gone ? "opacity-70" : "")
                }
              >
                <Link href={`/annonces/${i.id}` as never} className="block">
                  <div className="relative aspect-[4/3] bg-surface-2">
                    {i.coverPath ? (
                      <ListingImage path={i.coverPath} alt={i.title} sizes="(min-width:1280px) 22vw, 30vw" fit="cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-muted">
                        <ImageOff className="size-6" />
                      </span>
                    )}
                    {i.gone && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/75 py-1 text-center text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-white">
                        {t("unavailable")}
                      </span>
                    )}
                  </div>
                </Link>

                {/* The heart stays on the card: this page is where people come
                    to REMOVE things, and hunting for that control is the one
                    thing it must not make you do. */}
                <div className="absolute end-2 top-2">
                  <FavoriteButton listingId={i.id} initialSaved loggedIn size="sm" onSavedChange={follow(i.id)} />
                </div>

                <div className="p-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{i.category}</span>
                  <Link href={`/annonces/${i.id}` as never} className="block">
                    <h2 className="mt-0.5 line-clamp-2 min-h-[2.5em] text-[13.5px] font-bold leading-snug text-foreground hover:text-gold">
                      {i.title}
                    </h2>
                  </Link>
                  <p className="mazed-tabular mt-1 text-[15px] font-extrabold text-foreground">
                    {priceLabel(i, t("onRequest"))}
                  </p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                    <MapPin className="size-3" /> {i.place}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
