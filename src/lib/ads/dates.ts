/**
 * A campaign's dates, as the admin says them and as the table stores them.
 *
 * The admin picks days — « du 27 octobre au 26 novembre » — and an advertiser
 * buys whole days. The table holds two instants: `starts_at`, the first moment
 * the banner shows, and `ends_at`, the first moment it no longer does. So a
 * campaign « until 26 November » ends at midnight starting the 27th, in Tunis.
 *
 * Tunisia keeps UTC+1 all year (no summer time since 2009), so a Tunisian
 * midnight is a fixed offset, not a lookup. Days are YYYY-MM-DD. Pure.
 */
import { addDays } from "@/lib/dayChips";
import { isoDay } from "@/lib/listings/deal";
import { tunisDay } from "@/lib/visits";

export { tunisDay };

/** Midnight in Tunis, starting `day`, as an ISO instant. */
export function tunisMidnight(day: string): string {
  return new Date(`${day}T00:00:00+01:00`).toISOString();
}

/**
 * The instants for a campaign from `startDay` to `endDay`, both included.
 * Either may be missing: no start is « from now », no end is « until it is
 * switched off ». Null when a day is not a real one or the end comes before
 * the start.
 */
export function campaignWindow(
  startDay: string | null,
  endDay: string | null,
): { starts_at: string | null; ends_at: string | null } | null {
  const start = startDay ? isoDay(startDay) : null;
  const end = endDay ? isoDay(endDay) : null;
  if ((startDay && !start) || (endDay && !end)) return null;
  if (start && end && end < start) return null;
  return {
    starts_at: start ? tunisMidnight(start) : null,
    ends_at: end ? tunisMidnight(addDays(end, 1)) : null,
  };
}

/** The other way: the first and last day a stored campaign shows. */
export function campaignDays(
  startsAt: string | null,
  endsAt: string | null,
): { startDay: string | null; endDay: string | null } {
  const startMs = startsAt ? Date.parse(startsAt) : NaN;
  const endMs = endsAt ? Date.parse(endsAt) : NaN;
  return {
    startDay: Number.isNaN(startMs) ? null : tunisDay(new Date(startMs)),
    // The last day is the one before the instant it stops.
    endDay: Number.isNaN(endMs) ? null : tunisDay(new Date(endMs - 1)),
  };
}

/** `day` moved by `n` months; the 31st lands on the last day of a shorter
 *  month instead of spilling into the next one. */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const lastOfMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(d, lastOfMonth));
  return first.toISOString().slice(0, 10);
}

/**
 * The last day of a campaign of `n` months starting `start`: one month from
 * 27 October runs through 26 November — what « un mois » means when it is
 * paid for.
 */
export function monthsFrom(start: string, n: number): string {
  return addDays(addMonths(start, n), -1);
}

export type AdDay = { day: string; views: number; clicks: number };

/**
 * The last `n` days up to `today`, oldest first, with the days nobody saw the
 * banner as zeros — `ad_daily` only has a line for a day something happened,
 * and a report with holes reads as a report with missing data.
 */
export function lastDays(rows: readonly AdDay[], today: string, n = 30): AdDay[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - (n - 1));
    const r = byDay.get(day);
    return { day, views: Number(r?.views ?? 0), clicks: Number(r?.clicks ?? 0) };
  });
}
