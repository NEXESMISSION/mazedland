/**
 * Agence reports (cahier P5, 0183) — pure: what a period brought to an
 * agence's annonces, from the counts `shop_report` returns as
 * [listing_id, Tunis day, count] per metric.
 *
 * The page asks for twice the period, so the period just before can be
 * compared with it. That comparison is left out when the traces it needs are
 * older than what Réglages → Données personnelles keeps: a drop that only
 * says « deleted by the nightly job » is not a drop.
 */

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_METRICS = ["visitors", "reveals", "favourites", "visits", "leads"] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

/** What `shop_report` returns: per metric, [listing_id | null, "YYYY-MM-DD", count]. */
export type RawReport = Partial<Record<ReportMetric, [string | null, string, number][]>>;

export type Totals = Record<ReportMetric, number>;

export type ReportListing = { id: string; reference: string | null; title: string; sellerId: string; status: string };
export type ReportMember = { userId: string; name: string };

export type ListingLine = ReportListing & Totals;
export type AgentLine = ReportMember & Totals & { listings: number };

export type ShopReport = {
  days: ReportPeriod;
  /** First and last Tunis day of the period, inclusive. */
  from: string;
  to: string;
  totals: Totals;
  /** The period just before, when its traces are still kept. */
  previous: Totals | null;
  series: ({ day: string } & Totals)[];
  listings: ListingLine[];
  agents: AgentLine[];
};

export function parsePeriod(raw: unknown): ReportPeriod {
  const n = Number(raw);
  return (REPORT_PERIODS as readonly number[]).includes(n) ? (n as ReportPeriod) : 30;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The `days` Tunis days ending on `today`, oldest first. */
export function periodDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
}

const zero = (): Totals => ({ visitors: 0, reveals: 0, favourites: 0, visits: 0, leads: 0 });

/**
 * Whether the traces of the previous period are all still kept: views and
 * reveals go after `privacy_traces_days` (0 = kept). The other metrics are
 * records that the jobs never delete.
 */
export function canCompare(days: number, tracesKeptDays: number): boolean {
  return tracesKeptDays === 0 || tracesKeptDays >= days * 2;
}

/** The change from `prev` to `cur`, in whole percent; null when there was nothing before. */
export function change(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export function buildReport(input: {
  raw: RawReport;
  days: ReportPeriod;
  today: string;
  listings: readonly ReportListing[];
  members: readonly ReportMember[];
  /** Agents see their own annonces only: no per-agent table. */
  byAgent: boolean;
  tracesKeptDays: number;
}): ShopReport {
  const { raw, days, today } = input;
  const current = periodDays(today, days);
  const from = current[0];
  const prevFrom = addDays(from, -days);
  const inCurrent = new Set(current);

  const totals = zero();
  const previous = zero();
  const byDay = new Map(current.map((d) => [d, zero()]));
  const byListing = new Map<string, Totals>();

  for (const metric of REPORT_METRICS) {
    for (const [listingId, day, n] of raw[metric] ?? []) {
      const count = Number(n) || 0;
      if (inCurrent.has(day)) {
        totals[metric] += count;
        byDay.get(day)![metric] += count;
        if (listingId) {
          const line = byListing.get(listingId) ?? zero();
          line[metric] += count;
          byListing.set(listingId, line);
        }
      } else if (day >= prevFrom && day < from) {
        previous[metric] += count;
      }
    }
  }

  const listings: ListingLine[] = input.listings
    .map((l) => ({ ...l, ...(byListing.get(l.id) ?? zero()) }))
    .filter((l) => REPORT_METRICS.some((m) => l[m] > 0) || l.status === "published")
    .sort((a, b) => b.visitors - a.visitors || b.reveals - a.reveals || a.title.localeCompare(b.title));

  const agents: AgentLine[] = input.byAgent
    ? input.members
        .map((m) => {
          const own = listings.filter((l) => l.sellerId === m.userId);
          const line: AgentLine = { ...m, ...zero(), listings: input.listings.filter((l) => l.sellerId === m.userId && l.status === "published").length };
          for (const l of own) for (const metric of REPORT_METRICS) line[metric] += l[metric];
          return line;
        })
        .sort((a, b) => b.reveals - a.reveals || b.visitors - a.visitors || a.name.localeCompare(b.name))
    : [];

  return {
    days,
    from,
    to: today,
    totals,
    previous: canCompare(days, input.tracesKeptDays) ? previous : null,
    series: current.map((day) => ({ day, ...byDay.get(day)! })),
    listings,
    agents,
  };
}

/** One line per annonce, for a spreadsheet: `;`-separated (French Excel), quoted. */
export function reportCsv(report: ShopReport, headers: Record<"reference" | "title" | ReportMetric, string>): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const cols = ["reference", "title", ...REPORT_METRICS] as const;
  const lines = [cols.map((c) => cell(headers[c])).join(";")];
  for (const l of report.listings) {
    lines.push(cols.map((c) => cell(c === "reference" ? (l.reference ?? "") : c === "title" ? l.title : l[c])).join(";"));
  }
  // A BOM, so Excel reads the accents and the Arabic as UTF-8.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
