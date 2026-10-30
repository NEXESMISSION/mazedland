/**
 * Changing an agence's plan (the owner's rules, 2026-10-28) — pure, so the
 * « Abonnement » tab, the subscribe route and the payment queue agree.
 *
 *  - Upgrade (a plan with more annonces): the time not used on the current
 *    plan is a discount, in dinars — its price × the share of its period still
 *    ahead (a period paid in advance counts whole). The owner pays « new
 *    price − discount », and the new plan runs from the day it is paid to the
 *    same day the next month. It replaced « the days left are added to the
 *    new plan » (PR #12).
 *  - Downgrade (fewer annonces): it starts when what is paid for ends.
 *  - The same plan while it runs: not bought again — « you have it until … »
 *    — except in the last days before it ends (Réglages, plan_renew_days),
 *    when it is renewed from that end.
 *
 * « What is paid for » is what is paid for at that level or above: a smaller
 * plan queued behind the running one neither pushes the start of the next
 * period back nor counts as « until » (the QA tour, 2026-10-30: Pro to the
 * 30th, Starter queued for a month after it, and the Pro card said « until
 * 30 dec. »). Whatever starts replaces the smaller periods still ahead of its
 * start, as an upgrade does: they end when it starts, or are cancelled, and
 * their unused time is the discount — so the owner who queued Starter behind
 * Pro can keep Pro after all, at once, and the Starter month comes off.
 *
 * A period given by an admin, not paid, gives no discount. The discount is in
 * whole dinars, rounded down, and never more than the new price.
 */

export type PlanPeriod = {
  id: string;
  quota: number;
  /** The list price of that period's plan, in dinars. */
  price: number;
  /** Paid for (a captured payment); a period given by an admin is not. */
  paid: boolean;
  startsAt: Date;
  endsAt: Date;
};

export type PlanTarget = { quota: number; price: number; months: number };

export type CreditLine = { periodId: string; days: number; amount: number };

export type PlanQuote =
  | {
      kind: "new" | "upgrade" | "downgrade" | "renew";
      price: number;
      /** What the replaced periods take off the price; 0 when nothing is replaced. */
      credit: number;
      amount: number;
      lines: CreditLine[];
      /** The smaller periods still ahead when this one starts: ended then if running, cancelled if wholly ahead. */
      replaces: string[];
      startsAt: Date;
      endsAt: Date;
    }
  /** The same plan, still running and not yet in its renewal days. */
  | { kind: "same"; until: Date; renewFrom: Date };

/** Every answer but « same »: a period to pay for. */
export type PlanPurchase = Exclude<PlanQuote, { kind: "same" }>;

const DAY = 86_400_000;

/** The same day `months` later, the last day of the month when it has none (31 Jan → 28 Feb). */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** A plan's length in months, from its duration in days (30 → 1). */
export function monthsOf(durationDays: number): number {
  return Math.max(1, Math.round((Number.isFinite(durationDays) ? durationDays : 30) / 30));
}

export function quotePlanChange(input: {
  now: Date;
  target: PlanTarget;
  /** The shop's active periods (status active), any order. */
  periods: readonly PlanPeriod[];
  /** Renewing the same plan opens this many days before it ends. */
  renewDays: number;
}): PlanQuote {
  const { now, target } = input;
  const t = now.getTime();
  const ahead = input.periods.filter((p) => p.endsAt.getTime() > t);
  const running = ahead
    .filter((p) => p.startsAt.getTime() <= t)
    .sort((a, b) => b.quota - a.quota || b.endsAt.getTime() - a.endsAt.getTime())[0];
  // What is paid for at this level or above; a smaller plan queued behind does not count.
  const paidUntil = ahead
    .filter((p) => p.quota >= target.quota)
    .reduce<Date | null>((m, p) => (!m || p.endsAt > m ? p.endsAt : m), null);

  // A period starting at `startsAt`, and the smaller periods still ahead of
  // that moment, which it replaces: their time after it is the discount.
  const quote = (kind: PlanPurchase["kind"], startsAt: Date): PlanPurchase => {
    const s = startsAt.getTime();
    const lines: CreditLine[] = [];
    const replaces: string[] = [];
    for (const p of ahead) {
      if (p.quota >= target.quota || p.endsAt.getTime() <= s) continue;
      replaces.push(p.id);
      const start = Math.max(p.startsAt.getTime(), s);
      const whole = p.endsAt.getTime() - p.startsAt.getTime();
      const left = p.endsAt.getTime() - start;
      if (!p.paid || whole <= 0 || p.price <= 0) continue;
      lines.push({ periodId: p.id, days: Math.round(left / DAY), amount: (p.price * left) / whole });
    }
    const credit = Math.min(target.price, Math.floor(lines.reduce((n, l) => n + l.amount, 0)));
    return {
      kind,
      price: target.price,
      credit,
      amount: target.price - credit,
      lines: lines.map((l) => ({ ...l, amount: Math.floor(l.amount) })),
      replaces,
      startsAt,
      endsAt: addMonths(startsAt, target.months),
    };
  };

  // Nothing runs today; a period of this plan or a bigger one paid ahead (rare) is followed.
  if (!running) return quote("new", paidUntil ?? now);
  if (target.quota > running.quota) return quote("upgrade", now);

  const from = paidUntil ?? running.endsAt;
  if (target.quota < running.quota) return quote("downgrade", from);

  // The same plan: renewed from its end in its last days — or at once when a
  // smaller plan is queued behind it, since renewing is how that one is replaced.
  const renewal = quote("renew", from);
  const renewFrom = new Date(from.getTime() - Math.max(0, input.renewDays) * DAY);
  if (t < renewFrom.getTime() && renewal.replaces.length === 0) return { kind: "same", until: from, renewFrom };
  return renewal;
}
