/**
 * A date or an instant as the database reads them: `2026-02-15`,
 * `2026-02-15T10:00`, `2026-02-15T10:00:00.000Z`, `2026-02-15T10:00:00+01:00`.
 *
 * `Date.parse` is not the test. It takes « 2026-02-30 » (and slides it to
 * March), « 1 » and « Feb 30 2026 », all of which Postgres refuses — so a
 * filter or a popup window written that way came back as a 500. The shape is
 * fixed by the pattern; the round trip through UTC catches a day the month
 * does not have.
 */
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export function isIsoInstant(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (
    day.getUTCFullYear() !== Number(y) ||
    day.getUTCMonth() !== Number(mo) - 1 ||
    day.getUTCDate() !== Number(d)
  ) {
    return false;
  }
  return Number(h) < 24 && Number(mi) < 60 && Number(s) < 60 && !Number.isNaN(Date.parse(v));
}
