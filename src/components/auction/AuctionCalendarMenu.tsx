"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Download, Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/**
 * Auction calendar dropdown — sits on the auction price card next to
 * the countdown so the user sees it at the urgency moment. Offers a
 * Google Calendar deep link and a universal .ics download (Apple
 * Calendar / Outlook / etc.).
 *
 * Mobile platform detection picks the most relevant option first so
 * iPhone users don't hunt for "Apple" and Android users don't hunt
 * for "Google" — both options are still always present.
 *
 * The .ics route is server-rendered with the latest ends_at; click
 * navigation lets the browser hand off to the OS calendar app.
 */
export function AuctionCalendarMenu({
  auctionId,
  endsAt,
  startsAt,
  status,
  title,
  governorate,
  delegation,
}: {
  auctionId: string;
  endsAt: string;
  startsAt: string | null;
  status: string;
  title: string;
  governorate: string;
  delegation: string | null;
}) {
  const t = useTranslations("auction.calendar");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [iosFirst, setIosFirst] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Hide for already-ended auctions — a reminder for a past event is
  // pure noise. Statuses pulled from AuctionStatus in src/lib/types.ts;
  // the time-check is a belt-and-braces fallback if the status is stale.
  const isEnded =
    status === "ended_sold" ||
    status === "ended_unsold" ||
    status === "awarded" ||
    status === "cancelled" ||
    new Date(endsAt).getTime() <= Date.now();

  // For scheduled auctions, the reminder is for the OPENING (when
  // bidding starts). Live/extending auctions use the CLOSING moment.
  const isScheduled = status === "scheduled" && startsAt && new Date(startsAt).getTime() > Date.now();

  useEffect(() => {
    // iOS / iPadOS hint — order Apple option first. Userland sniff,
    // not a runtime gate, so a wrong guess just reorders the menu.
    const ua = navigator.userAgent || "";
    setIosFirst(/iPhone|iPad|iPod|Macintosh/.test(ua));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (isEnded) return null;

  const buttonLabel = isScheduled ? t("openingLabel") : t("closingLabel");

  function googleCalendarUrl(): string {
    // Event timing mirrors the .ics route: 5 min before close → 15
    // min after, so the alarm reads as "the auction is about to close"
    // rather than "you missed it".
    const baseAt = isScheduled && startsAt ? new Date(startsAt) : new Date(endsAt);
    // Closing event opens 5 min before the auction closes so the
    // calendar UI reads as "about to close" rather than "missed it";
    // opening events start exactly at starts_at. Both end 15 min later
    // to cover a typical bidding extension window.
    const startMs = isScheduled ? baseAt.getTime() : baseAt.getTime() - 5 * 60 * 1000;
    const endMs = baseAt.getTime() + 15 * 60 * 1000;

    const dates =
      formatGoogleDate(new Date(startMs)) + "/" + formatGoogleDate(new Date(endMs));

    const summary = isScheduled
      ? `Ouverture des enchères: ${title}`
      : `Enchère: ${title}`;
    const location = [governorate, delegation].filter(Boolean).join(", ");
    const url = `${window.location.origin}/fr/auctions/${auctionId}`;
    const details = [
      isScheduled
        ? `Les enchères ouvrent pour: ${title}`
        : `Clôture de l'enchère: ${title}`,
      "",
      `Lien: ${url}`,
    ].join("\n");

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: summary,
      dates,
      details,
      location,
      ctz: "Africa/Tunis",
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function onPickGoogle() {
    window.open(googleCalendarUrl(), "_blank", "noopener");
    setOpen(false);
    // Honest copy: we've opened the Google add-event form, but the
    // user still has to hit Save. Saying "ajouté" would be a lie.
    toast(t("openedGoogle"), "info");
  }

  function onPickIcs() {
    // Same-origin GET. Browser handles MIME → OS hands off to the
    // calendar app. Triggered via anchor click so the download is
    // bound to a user gesture (Safari requirement).
    const a = document.createElement("a");
    a.href = `/api/auctions/${auctionId}/ics`;
    a.rel = "noopener";
    a.click();
    setOpen(false);
    toast(t("downloaded"), "info");
  }

  const googleItem = (
    <button
      key="google"
      type="button"
      onClick={onPickGoogle}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-[13px] font-semibold text-foreground hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
    >
      <CalendarIcon className="size-4 shrink-0 text-gold" strokeWidth={2} />
      {t("google")}
    </button>
  );
  const icsItem = (
    <button
      key="ics"
      type="button"
      onClick={onPickIcs}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-[13px] font-semibold text-foreground hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
    >
      <Download className="size-4 shrink-0 text-gold" strokeWidth={2} />
      {t("appleOutlook")}
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground ring-1 ring-gold/25 transition hover:ring-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.98]"
      >
        <CalendarPlus className="size-3.5 text-gold" strokeWidth={2.25} />
        {buttonLabel}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-20 mt-2 w-60 origin-top rounded-xl border border-gold/25 bg-surface p-1.5 shadow-xl shadow-black/40 backdrop-blur-sm ltr:right-0 ltr:origin-top-right rtl:left-0 rtl:origin-top-left"
        >
          {iosFirst ? [icsItem, googleItem] : [googleItem, icsItem]}
        </div>
      )}
    </div>
  );
}

/** Google Calendar wants YYYYMMDDTHHmmssZ (UTC, no separators). */
function formatGoogleDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
