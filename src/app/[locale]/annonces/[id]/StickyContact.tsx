"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircle, Phone } from "lucide-react";
import { useSetting } from "@/components/settings/SettingsProvider";
import { useCompare } from "@/components/compare/compareStore";
import { contactLinks, useContactReveal } from "./ContactReveal";

/**
 * The seller's number within reach on a phone.
 *
 * A phone opens this page on a tall photo, then the title and the price; the
 * seller card with « Afficher le numéro » starts below the first screen, so
 * the one thing a buyer came to do was out of sight. This bar holds the price
 * and that button just above the bottom navigation while the card is off
 * screen, and steps away while the card itself is in view, so the two never
 * show together. It is the card's reveal (useContactReveal): tapping either
 * shows the number in both, and then the bar offers « Appeler » and WhatsApp.
 *
 * Phones and tablets only — the desktop rail already follows the page down.
 */
export function StickyContact({
  listingId,
  price,
  watchId,
}: {
  listingId: string;
  /** The price as the page prints it: « 450 000 TND », « 1 200 TND / mois ». */
  price: string;
  /** The id of the phone column's seller card. */
  watchId: string;
}) {
  const t = useTranslations("listing.contact");
  const { contact, busy, reveal } = useContactReveal(listingId);
  // Hidden until the observer has said where the card is: no flash of a bar
  // over a card that is already on screen.
  const [cardInView, setCardInView] = useState(true);
  // The comparison tray floats just above the bottom bar too. While it shows,
  // this bar sits above it instead of on top of it.
  const compareOn = useSetting("feature_compare");
  const compared = useCompare().ids.length;
  const trayUp = compareOn && compared > 0;

  useEffect(() => {
    // Without an observer the bar simply never shows: the page is as it was.
    const card = document.getElementById(watchId);
    if (!card || typeof IntersectionObserver === "undefined") return;
    // The card counts as in view only once its button clears the top bar and
    // the bottom navigation — not when a sliver of its edge peeks in.
    const io = new IntersectionObserver(([entry]) => setCardInView(entry.isIntersecting), {
      rootMargin: "-56px 0px -180px 0px",
    });
    io.observe(card);
    return () => io.disconnect();
  }, [watchId]);

  const links = contact ? contactLinks(contact) : null;
  const bar = (
    <div
      className="fixed inset-x-0 z-20 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur-md lg:hidden"
      style={{
        bottom: trayUp
          ? "calc(var(--mazed-bottombar-h) + env(safe-area-inset-bottom) + 56px)"
          : "calc(var(--mazed-bottombar-h) + env(safe-area-inset-bottom))",
      }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <p className="mazed-tabular min-w-0 flex-1 truncate text-[15px] font-extrabold text-foreground">{price}</p>
        {links ? (
          <>
            <a
              href={links.tel}
              className="mazed-btn-luxe tap-target inline-flex h-11 shrink-0 items-center gap-1.5 px-4 text-[14px]"
            >
              <Phone className="size-4" strokeWidth={2.5} />
              {t("call")}
            </a>
            <a
              href={links.whatsapp}
              target="_blank"
              rel="noreferrer"
              aria-label="WhatsApp"
              className="tap-target grid size-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-foreground transition hover:border-gold-soft"
            >
              <MessageCircle className="size-5" strokeWidth={2.2} />
            </a>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void reveal()}
            disabled={busy}
            className="mazed-btn-luxe tap-target inline-flex h-11 shrink-0 items-center gap-1.5 px-4 text-[14px] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" strokeWidth={2.5} />}
            {t("reveal")}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Room at the end of the page, so the bar never covers its last lines. */}
      <div aria-hidden className="h-16 lg:hidden" />
      {/* Portalled to <body>: every page sits in template.tsx's
          `.mazed-page-enter`, whose animation leaves an identity transform
          behind, and a transformed ancestor makes `fixed` relative to it — the
          bar landed at the foot of the page instead of the screen. Rendered
          only once the observer has run, so `document` exists by then. */}
      {!cardInView && createPortal(bar, document.body)}
    </>
  );
}
