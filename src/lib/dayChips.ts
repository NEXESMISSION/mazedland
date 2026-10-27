/**
 * Days as chips: « Aujourd'hui », « Demain », « Sam. 2 nov. » … for a visit
 * (0174), and the first days of the coming months for a tenant's move-in.
 * A date picker on a phone is three taps and a scroll, for a day that is
 * almost always this week; « Autre date » keeps the picker for the rest.
 *
 * Days are YYYY-MM-DD as said in Tunisia (`tunisDay`), so the chips and the
 * API's window agree whatever the phone's time zone. Pure.
 */
import { intlTag } from "@/lib/utils";

/** `day` moved by `n` days, at noon UTC so no time zone tips it over. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Today and the days after it, `count` in all, never past `horizonDays` from
 * today — the last day the console lets a visit be proposed for.
 */
export function nextDays(today: string, horizonDays: number, count = 7): string[] {
  const n = Math.max(0, Math.min(count - 1, horizonDays));
  return Array.from({ length: n + 1 }, (_, i) => addDays(today, i));
}

/**
 * A day chip's text: the words for today and tomorrow, then the short
 * weekday with its date (« Sam. 2 nov. », « السبت، 2 نوفمبر »). Short,
 * because two of them must sit side by side on a 320 px phone.
 */
export function dayLabel(
  day: string,
  today: string,
  locale: string,
  words: { today: string; tomorrow: string },
): string {
  if (day === today) return words.today;
  if (day === addDays(today, 1)) return words.tomorrow;
  const tag = intlTag(locale);
  const s = new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(/ /g, " ");
  return s.charAt(0).toLocaleUpperCase(tag) + s.slice(1);
}

/**
 * The first day of each of the next `count` months, after today: the days a
 * tenant moves in on. On the 1st itself, that month is already under way.
 */
export function firstsOfMonth(today: string, count = 3): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m + i, 1, 12));
    return d.toISOString().slice(0, 10);
  });
}

/** « 1 déc. » · « 1 ديسمبر » — a move-in chip. */
export function dayMonthLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(/ /g, " ");
}
