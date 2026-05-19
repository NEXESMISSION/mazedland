import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Generate an .ics calendar file for a single auction. The event lands
 * a few minutes before `ends_at` so a 15-min reminder fires with enough
 * runway for the user to open the bidding page and log in. For
 * scheduled (not-yet-live) auctions we also emit a second VEVENT at
 * `starts_at` so bidders know when bidding opens.
 *
 * Auctions can extend on last-minute bids — we don't try to keep the
 * event in sync with that. The URL field links back to the auction page,
 * so even if the calendar entry is a few minutes stale, the user lands
 * on the live state in one tap.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await getServerSupabase();

  const { data, error } = await supabase
    .from("auctions")
    .select(`
      id, ends_at, starts_at, status, current_price, opening_price,
      property:properties (
        title, governorate, delegation
      )
    `)
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const a = data as unknown as {
    id: string;
    ends_at: string;
    starts_at: string | null;
    status: string;
    current_price: number | string | null;
    opening_price: number | string | null;
    property: {
      title: string;
      governorate: string;
      delegation: string | null;
    };
  };

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const auctionUrl = `${origin}/fr/auctions/${a.id}`;

  // End time of the calendar event: ends_at + 15 min, so the event
  // bracket covers the last bidding minute + a typical 10-min auction
  // extension. Start the visible event 5 min before close so the
  // reminder + the event title both land at the urgency moment.
  const endsMs = new Date(a.ends_at).getTime();
  const closeStart = new Date(endsMs - 5 * 60 * 1000);
  const closeEnd = new Date(endsMs + 15 * 60 * 1000);

  const price = a.current_price ?? a.opening_price;
  const priceLabel = price != null ? `${Number(price).toLocaleString("fr-FR")} TND` : "";

  const location = [a.property.governorate, a.property.delegation]
    .filter(Boolean)
    .join(", ");

  // Per-event descriptions — the close and open events tell different
  // stories. Sentinel "__blank__" survives .filter(Boolean) so we can
  // keep a visual gap between the body and the Lien: line that calendar
  // apps render with the right spacing.
  function describe(headline: string): string {
    return [
      headline,
      priceLabel ? `Prix actuel: ${priceLabel}` : "",
      "__blank__",
      `Lien: ${auctionUrl}`,
    ]
      .filter(Boolean)
      .map((s) => (s === "__blank__" ? "" : s))
      .join("\n");
  }

  const events: string[] = [];

  // Closing event — the urgency moment. Always emitted.
  events.push(
    buildEvent({
      uid: `auction-${a.id}-close@batta.tn`,
      summary: `Enchère: ${a.property.title}`,
      description: describe(`Clôture de l'enchère: ${a.property.title}`),
      url: auctionUrl,
      location,
      start: closeStart,
      end: closeEnd,
      alarmDescription: `Enchère clôt dans 15 min: ${a.property.title}`,
    }),
  );

  // Opening event for scheduled auctions — fires when bidding opens.
  if (a.status === "scheduled" && a.starts_at) {
    const startMs = new Date(a.starts_at).getTime();
    if (startMs > Date.now()) {
      const openStart = new Date(startMs);
      const openEnd = new Date(startMs + 15 * 60 * 1000);
      events.push(
        buildEvent({
          uid: `auction-${a.id}-open@batta.tn`,
          summary: `Ouverture des enchères: ${a.property.title}`,
          description: describe(`Ouverture des enchères: ${a.property.title}`),
          url: auctionUrl,
          location,
          start: openStart,
          end: openEnd,
          alarmDescription: `Les enchères ouvrent dans 15 min: ${a.property.title}`,
        }),
      );
    }
  }

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Batta//Auction Reminder//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  // RFC 5545 line folding: any logical line > 75 octets must be split
  // with CRLF + leading space. Done after assembly so SUMMARY /
  // DESCRIPTION lines with long property titles still validate.
  const folded = foldLines(body);

  return new NextResponse(folded, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="batta-auction-${a.id.slice(0, 8)}.ics"`,
      // Stale-while-revalidate so multiple downloads in a session don't
      // re-hit the DB, but the event refreshes if ends_at shifts.
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    },
  });
}

function buildEvent(args: {
  uid: string;
  summary: string;
  description: string;
  url: string;
  location: string;
  start: Date;
  end: Date;
  alarmDescription: string;
}): string {
  return [
    "BEGIN:VEVENT",
    `UID:${args.uid}`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(args.start)}`,
    `DTEND:${toICSDate(args.end)}`,
    `SUMMARY:${escapeText(args.summary)}`,
    `DESCRIPTION:${escapeText(args.description)}`,
    `LOCATION:${escapeText(args.location)}`,
    `URL:${args.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(args.alarmDescription)}`,
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
  ].join("\r\n");
}

/** UTC ICS timestamp: 20260519T143000Z */
function toICSDate(d: Date): string {
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

/** Escape RFC 5545 TEXT fields. Order matters — escape backslash first. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold any line > 75 octets per RFC 5545 §3.1. */
function foldLines(input: string): string {
  const out: string[] = [];
  for (const line of input.split("\r\n")) {
    if (Buffer.byteLength(line, "utf8") <= 75) {
      out.push(line);
      continue;
    }
    // Split into 73-byte chunks (leaving room for the leading space
    // that joins folded continuations).
    let remaining = line;
    let first = true;
    while (Buffer.byteLength(remaining, "utf8") > 75) {
      let take = 73;
      while (Buffer.byteLength(remaining.slice(0, take), "utf8") > 73 && take > 1) take--;
      out.push((first ? "" : " ") + remaining.slice(0, take));
      remaining = remaining.slice(take);
      first = false;
    }
    out.push(" " + remaining);
  }
  return out.join("\r\n");
}
